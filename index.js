const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

// Configura o caminho do ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// INSIRA SEU NÚMERO AQUI (Com DDI e DDD, ex: para Portugal use 3519xxxxxxxxx, para o Brasil use 55119xxxxxxxxx)
const phoneNumber = "351912045423"; // <--- Coloque seu número real aqui!

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
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso na nuvem!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Pede o código de pareamento se ainda não estiver registrado
    if (!sock.authState.creds.registered) {
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
        }, 5000);
    }

    // Listener de mensagens atualizado para capturar comandos e mídias corretamente
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const messageType = Object.keys(msg.message)[0];
        
        // Pega o texto da mensagem ou a legenda de uma imagem/vídeo
        const text = msg.message.conversation || 
                     msg.message.imageMessage?.caption || 
                     msg.message.videoMessage?.caption || '';

        console.log(`📩 Mensagem recebida: "${text}" | Tipo: ${messageType}`);

        // Verifica o comando .sticker
        if (text.toLowerCase() === '.sticker' || text.toLowerCase() === '.f') {
            const isImage = messageType === 'imageMessage';
            const isVideo = messageType === 'videoMessage';

            if (isImage || isVideo) {
                console.log('🖼️ Mídia detectada com o comando .sticker! Processando...');
                
                try {
                    // Aqui entra a lógica de download e conversão para figurinha usando o fluent-ffmpeg
                    // Exemplo básico de resposta para testar se o fluxo chegou aqui:
                    await sock.sendMessage(msg.key.remoteJdf || msg.key.remoteJid, { text: 'Recebi sua imagem! Gerando figurinha...' }, { quoted: msg });
                } catch (err) {
                    console.error('Erro ao processar a mídia:', err);
                }
            } else {
                console.log('⚠️ O comando .sticker foi enviado, mas sem uma imagem ou vídeo junto.');
                await sock.sendMessage(msg.key.remoteJid, { text: 'Envie uma imagem ou vídeo junto com a legenda .sticker!' }, { quoted: msg });
            }
        }
    });
}

connectToWhatsApp();