const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

// Configura o caminho do ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// INSIRA SEU NÚMERO AQUI (Com DDI e DDD, ex: para Portugal use 3519xxxxxxxx, para o Brasil use 55119xxxxxxxx)
const phoneNumber = "351912345678"; // <--- MUITA ATENÇÃO: Substitua pelo seu número real!

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false // Desativado pois estamos na nuvem
    });

    // Se ainda não estiver autenticado, gera o código de pareamento automaticamente
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================`);
                console.log(`🔑 CÓDIGO DE PAREAMENTO: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.error("Erro ao gerar código de pareamento:", error);
            }
        }, 4000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso na nuvem!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Suas lógicas de recebimento de mensagens e criação de figurinhas continuam aqui...
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // Aqui fica o seu código atual de manipulação de mensagens/figurinhas...
    });
}

connectToWhatsApp();