const axios = require('axios');
const cheerio = require('cheerio');

// Temporary storage to hold search results memory for the user
let activeSearches = {};

module.exports = {
    name: 'cinesubz',
    alias: ['movie', 'down'],
    category: 'download',
    desc: 'Search and download movies from CineSubz',
    async execute(Client, message, args, commandName) {
        const sender = message.sender;

        // --- STEP 1: SEARCH FOR A MOVIE ---
        if (commandName === 'cinesubz') {
            const query = args.join(' ');
            if (!query) return message.reply('Please provide a movie name! Example: .cinesubz Avatar');

            try {
                await message.reply('🔍 Searching CineSubz...');
                const searchUrl = `https://cinesubz.co/?s=${encodeURIComponent(query)}`;
                const { data } = await axios.get(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const $ = cheerio.load(data);
                let results = [];

                $('.result-item').each((index, element) => {
                    const title = $(element).find('.title a').text().trim();
                    const link = $(element).find('.title a').attr('href');
                    if (title && link) results.push({ title, link });
                });

                if (results.length === 0) return message.reply('❌ No movies found.');

                // Save results in memory linked to this user
                activeSearches[sender] = results;

                let responseText = `*🎬 CINESUBZ RESULTS 🎬*\n\n`;
                results.forEach((movie, i) => {
                    responseText += `${i + 1}. *${movie.title}*\n`;
                });
                responseText += `\n*To download:* Reply with \`.down <number>\` (Example: .down 1)`;
                
                await message.reply(responseText);
            } catch (e) {
                message.reply('❌ Error fetching search results.');
            }
        }

        // --- STEP 2: DOWNLOAD DIRECT FILE ---
        if (commandName === 'down') {
            const index = parseInt(args[0]) - 1;
            const userResults = activeSearches[sender];

            if (!userResults || isNaN(index) || !userResults[index]) {
                return message.reply('❌ Invalid selection or no active search. Search first with .cinesubz <name>');
            }

            const chosenMovie = userResults[index];

            try {
                await message.reply(`📥 Scraping download links for:\n*${chosenMovie.title}*... Please wait.`);

                // Go inside the movie page
                const { data } = await axios.get(chosenMovie.link, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const $ = cheerio.load(data);
                
                let downloadLinks = [];

                // Scrape Pixeldrain/Mega/Gdrive links hidden inside tables or download buttons
                $('a').each((i, el) => {
                    const href = $(el).attr('href') || '';
                    const text = $(el).text().toLowerCase();
                    
                    // Look for common cloud hosting links used by CineSubz
                    if (href.includes('pixeldrain.com') || href.includes('drive.google.com') || href.includes('mega.nz')) {
                        downloadLinks.push({ text: $(el).text().trim() || 'Download Link', url: href });
                    }
                });

                if (downloadLinks.length === 0) {
                    return message.reply('❌ Could not automatically extract high-speed video files. Here is the web link to download manually:\n' + chosenMovie.link);
                }

                // Pick the first link (usually PixelDrain or High Speed stream)
                let targetLink = downloadLinks[0].url;

                // If it is a Pixeldrain link, convert it to a direct document download stream
                if (targetLink.includes('pixeldrain.com/u/')) {
                    const fileId = targetLink.split('/u/')[1].split('?')[0];
                    const directDownloadUrl = `https://pixeldrain.com/api/file/${fileId}`;

                    await message.reply('⚡ High-speed link found! Uploading file to WhatsApp...');
                    
                    // Send it as a document/video over WhatsApp
                    await Client.sendMessage(message.chat, { 
                        document: { url: directDownloadUrl }, 
                        mimetype: 'video/mp4', 
                        fileName: `${chosenMovie.title}.mp4` 
                    });
                } else {
                    // Fallback if it's GDrive or Mega which can't be easily hot-linked directly without API keys
                    let replyText = `📎 *Available Links for ${chosenMovie.title}:*\n\n`;
                    downloadLinks.forEach((dl, i) => {
                        replyText += `${i+1}. ${dl.text}:\n${dl.url}\n\n`;
                    });
                    await message.reply(replyText);
                }

            } catch (error) {
                console.error(error);
                message.reply('❌ Failed to process the download link.');
            }
        }
    }
};
