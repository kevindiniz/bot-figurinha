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

    // Listener de mensagens que aceita tanto imagem com legenda quanto responder a uma imagem
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        
        // Verifica se a mensagem veio com texto direto ou legenda de mídia
        const messageType = Object.keys(msg.message)[0];
        const text = msg.message.conversation || 
                     msg.message.imageMessage?.caption || 
                     msg.message.videoMessage?.caption || 
                     msg.message.extendedTextMessage?.text || '';

        // Verifica se é o comando de figurinha (.sticker ou .f)
        const isStickerCommand = text.toLowerCase() === '.sticker' || text.toLowerCase() === '.f';

        if (isStickerCommand) {
            // Cenário 1: A imagem/vídeo foi enviada junto com a legenda na mesma mensagem
            const isDirectMedia = messageType === 'imageMessage' || messageType === 'videoMessage';

            // Cenário 2: O usuário respondeu a uma mensagem anterior que continha imagem/vídeo
            const quotedMessage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const isQuotedMedia = quotedMessage && (quotedMessage.imageMessage || quotedMessage.videoMessage);

            if (isDirectMedia || isQuotedMedia) {
                console.log('🖼️ Mídia válida detectada para figurinha! Processando...');
                
                try {
                    // Aqui entra o seu código de baixar a mídia e converter com o ffmpeg/baileys
                    await sock.sendMessage(remoteJid, { text: 'Recebi! Gerando sua figurinha...' }, { quoted: msg });
                } catch (err) {
                    console.error('Erro ao processar a mídia:', err);
                }
            } else {
                console.log('⚠️ Comando .sticker usado, mas nenhuma imagem/vídeo foi encontrada (nem direta, nem respondida).');
                await sock.sendMessage(remoteJid, { text: 'Envie uma imagem com a legenda .sticker ou responda a uma foto com .sticker!' }, { quoted: msg });
            }
        }
    });
}

connectToWhatsApp();