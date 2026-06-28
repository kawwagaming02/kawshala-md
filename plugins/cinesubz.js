const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const cheerio = require('cheerio');

// Function to scrape Baiscope for movies
async function searchBaiscopeMovie(query) {
    try {
        const url = `https://baiscope.lk{encodeURIComponent(query)}`;
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        
        let results = [];
        
        // Target article posts on Baiscope
        $('article').each((i, element) => {
            const title = $(element).find('.entry-title a').text().trim();
            const link = $(element).find('.entry-title a').attr('href');
            
            if (title && link) {
                results.push({ title, link });
            }
        });

        return results.slice(0, 5); // Return top 5 results
    } catch (error) {
        console.error('Error scraping Baiscope:', error);
        return [];
    }
}

// Start the WhatsApp Bot
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('Bot is ready and connected!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderNumber = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        // Bot command to search movies
        if (messageText.startsWith('!movie ')) {
            const query = messageText.replace('!movie ', '').trim();
            
            await sock.sendMessage(senderNumber, { text: `🔍 Searching for "${query}" on Baiscope...` });

            const movieResults = await searchBaiscopeMovie(query);

            if (movieResults.length > 0) {
                let replyText = "🎬 *Movie Results from Baiscope:* \n\n";
                movieResults.forEach((movie, index) => {
                    replyText += `${index + 1}. *${movie.title}*\n🔗 Link: ${movie.link}\n\n`;
                });
                await sock.sendMessage(senderNumber, { text: replyText });
            } else {
                await sock.sendMessage(senderNumber, { text: "⚠️ No movie subtitles found matching your query on Baiscope." });
            }
        }
    });
}

connectToWhatsApp();
