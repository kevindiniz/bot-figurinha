const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const phoneNumber = "351912045423"; // <--- Seu número com DDI e DDD

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) setTimeout(connectToWhatsApp, 3000);
        } else if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso na nuvem!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n🔑 CÓDIGO DE PAREAMENTO: ${code}\n`);
            } catch (error) {
                console.error("Erro ao gerar código:", error);
            }
        }, 5000);
    }

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const messageType = Object.keys(msg.message)[0];
        const text = msg.message.conversation || 
                     msg.message.imageMessage?.caption || 
                     msg.message.videoMessage?.caption || 
                     msg.message.extendedTextMessage?.text || '';

        const isStickerCommand = text.toLowerCase() === '.sticker' || text.toLowerCase() === '.f';

        if (isStickerCommand) {
            const isDirectMedia = messageType === 'imageMessage' || messageType === 'videoMessage';
            const quotedMessage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const isQuotedMedia = quotedMessage && (quotedMessage.imageMessage || quotedMessage.videoMessage);

            if (isDirectMedia || isQuotedMedia) {
                console.log('🖼️ Processando e convertendo para figurinha...');
                try {
                    // Define qual mensagem tem a mídia real para baixar
                    const targetMessage = isDirectMedia ? msg : { message: quotedMessage };
                    
                    // Baixa o arquivo de mídia
                    const buffer = await downloadMediaMessage(
                        targetMessage,
                        'buffer',
                        {},
                        { logger: P({ level: 'silent' }) }
                    );

                    const tempFile = path.join(__dirname, `temp_${Date.now()}.media`);
                    const outputFile = path.join(__dirname, `sticker_${Date.now()}.webp`);
                    fs.writeFileSync(tempFile, buffer);

                    // Converte usando o ffmpeg para o formato de Sticker (.webp)
                    await new Promise((resolve, reject) => {
                        ffmpeg(tempFile)
                            .inputOptions(['-y'])
                            .toFormat('webp')
                            .save(outputFile)
                            .on('end', resolve)
                            .on('error', reject);
                    });

                    // Envia a figurinha de volta no chat
                    await sock.sendMessage(remoteJid, { 
                        sticker: fs.readFileSync(outputFile) 
                    }, { quoted: msg });

                    // Limpa os arquivos temporários do servidor
                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

                    console.log('✨ Figurinha enviada com sucesso!');
                } catch (err) {
                    console.error('Erro ao converter a figurinha:', err);
                    await sock.sendMessage(remoteJid, { text: 'Erro ao gerar a figurinha. Tente novamente.' }, { quoted: msg });
                }
            }
        }
    });
}

connectToWhatsApp();