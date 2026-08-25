const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const phoneNumber = "351912045423"; 

const processedMessages = new Set();

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
        if (!msg.message) return;

        const msgId = msg.key.id;
        if (processedMessages.has(msgId)) return;
        processedMessages.add(msgId);
        setTimeout(() => processedMessages.delete(msgId), 10000);

        const remoteJid = msg.key.remoteJid;
        const messageType = Object.keys(msg.message)[0];
        const text = msg.message.conversation || 
                     msg.message.imageMessage?.caption || 
                     msg.message.videoMessage?.caption || 
                     msg.message.extendedTextMessage?.text || '';

        const isStickerCommand = text.toLowerCase() === '.s' || text.toLowerCase() === '.sticker' || text.toLowerCase() === '.f';

        if (isStickerCommand) {
            const isDirectMedia = messageType === 'imageMessage' || messageType === 'videoMessage';
            const quotedMessage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const isQuotedMedia = quotedMessage && (quotedMessage.imageMessage || quotedMessage.videoMessage);

            if (isDirectMedia || isQuotedMedia) {
                console.log('🖼️ Processando mídia em tela cheia (.s)...');
                try {
                    const targetMessage = isDirectMedia ? msg : { message: quotedMessage };
                    const isVideo = isDirectMedia ? messageType === 'videoMessage' : !!quotedMessage.videoMessage;

                    const buffer = await downloadMediaMessage(
                        targetMessage,
                        'buffer',
                        {},
                        { logger: P({ level: 'silent' }) }
                    );

                    const ext = isVideo ? 'mp4' : 'jpg';
                    const tempFile = path.join(__dirname, `temp_${Date.now()}.${ext}`);
                    const outputFile = path.join(__dirname, `sticker_${Date.now()}.webp`);
                    fs.writeFileSync(tempFile, buffer);

                    await new Promise((resolve, reject) => {
                        let command = ffmpeg(tempFile).inputOptions(['-y']);

                        if (isVideo) {
                            // Preenche o quadrado inteiro cortando o excesso proporcionalmente para vídeos
                            command.outputOptions([
                                '-vcodec libwebp',
                                '-vf scale=512:512:force_original_aspect_ratio=increase,crop=512:512,format=rgba,fps=15',
                                '-loop 0',
                                '-ss 00:00:00',
                                '-t 00:00:06',
                                '-preset default',
                                '-an',
                                '-vsync 0'
                            ]);
                        } else {
                            // Preenche o quadrado inteiro cortando o excesso proporcionalmente para imagens
                            command.outputOptions([
                                '-vcodec libwebp',
                                '-vf scale=512:512:force_original_aspect_ratio=increase,crop=512:512,format=rgba'
                            ]);
                        }

                        command.toFormat('webp').save(outputFile).on('end', resolve).on('error', reject);
                    });

                    await sock.sendMessage(remoteJid, { 
                        sticker: fs.readFileSync(outputFile) 
                    }, { quoted: msg });

                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

                    console.log('✨ Figurinha em tela cheia enviada com sucesso!');
                } catch (err) {
                    console.error('Erro ao converter a figurinha:', err);
                    await sock.sendMessage(remoteJid, { text: 'Erro ao gerar a figurinha. Tente novamente.' }, { quoted: msg });
                }
            }
        }
    });
}

connectToWhatsApp();