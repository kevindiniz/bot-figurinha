const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const phoneNumber = "351912045423"; // <--- SEU NÚMERO AQUI (com DDI e DDD)

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
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000); // Espera 3 segundos antes de tentar de novo para evitar loop
            }
        } else if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso na nuvem!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Pede o código de pareamento de forma segura assim que o socket inicializar
    if (!sock.authState.creds.registered) {
        // Aguarda alguns segundos para garantir que a conexão websocket abriu
        setTimeout(async () => {
            try {
                console.log('Solicitando código de pareamento...');
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================`);
                console.log(`🔑 CÓDIGO DE PAREAMENTO: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error("Erro ao gerar código de pareamento:", error);
            }
        }, 5000); // 5 segundos de espera para garantir conexão estável
    }

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        // Suas mensagens/figurinhas entram aqui
    });
}

connectToWhatsApp();