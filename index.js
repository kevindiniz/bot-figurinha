require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Configura para ler o número de telefone no terminal
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        logger: P({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false // IMPORTANTE: Desativa o QR Code visual
    });

    // Se não estiver autenticado, pede o número e gera o código
    if (!sock.authState.creds.registered) {
        console.log('\n📱 Bem-vindo ao Bot de Figurinhas!');
        console.log('Para conectar, precisamos gerar um código de emparelhamento.');
        const phoneNumber = await question('Digite o seu número do WhatsApp com DDI e DDD (ex: 5511999999999): ');
        
        // Aguarda um momento para inicializar e solicita o código
        console.log('⏳ Solicitando código ao WhatsApp...');
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber.trim());
                console.log(`\n🔑 SEU CÓDIGO DE PAREAMENTO É: ** ${code} **\n`);
                console.log('Digite este código no seu WhatsApp (em "Aparelhos Conectados" -> "Conectar com número de telefone").');
            } catch (error) {
                console.error('Erro ao solicitar código. Verifique se o número está correto com DDI/DDD.', error);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('\n✅ Bot conectado com sucesso! Envie .sticker na legenda de uma imagem.');
        } else if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== 401;
            console.log('⚠️ Conexão fechada.', shouldReconnect ? 'Tentando reconectar...' : 'Necessário novo login.');
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                // Se deu erro de login (401), apague a pasta de auth e reinicie
                if (fs.existsSync('auth_info')) fs.rmSync('auth_info', { recursive: true });
                console.log('Reiniciando para novo login...');
                connectToWhatsApp();
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const text = m.message.conversation || 
                     m.message.imageMessage?.caption || 
                     m.message.extendedTextMessage?.text || '';

        if (text.toLowerCase() === '.sticker') {
            try {
                let targetMessage = m;

                if (m.message.extendedTextMessage && m.message.extendedTextMessage.contextInfo) {
                    const quoted = m.message.extendedTextMessage.contextInfo;
                    targetMessage = {
                        key: { remoteJid: m.key.remoteJid, id: quoted.stanzaId },
                        message: quoted.quotedMessage
                    };
                }

                console.log('🔄 Baixando e processando a imagem...');
                
                const buffer = await downloadMediaMessage(
                    targetMessage,
                    'buffer',
                    {},
                    { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                );

                const inputPath = path.join(__dirname, `temp_${Date.now()}.input`);
                const outputPath = path.join(__dirname, `temp_${Date.now()}.webp`);

                fs.writeFileSync(inputPath, buffer);

                await new Promise((resolve, reject) => {
                    ffmpeg(inputPath)
                        .input(inputPath)
                        .addOutputOptions([
                            '-vcodec', 'libwebp',
                            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
                            '-q:v', '50'
                        ])
                        .toFormat('webp')
                        .save(outputPath)
                        .on('end', () => resolve())
                        .on('error', (err) => reject(err));
                });

                await sock.sendMessage(m.key.remoteJid, { 
                    sticker: fs.readFileSync(outputPath) 
                }, { quoted: m });

                fs.unlinkSync(inputPath);
                fs.unlinkSync(outputPath);
                console.log('✨ Figurinha enviada com sucesso!');

            } catch (error) {
                console.error('Erro ao criar figurinha:', error);
                await sock.sendMessage(m.key.remoteJid, { text: '❌ Erro ao criar a figurinha.' }, { quoted: m });
            }
        }
    });
}

connectToWhatsApp();