// plugins/baiscope-downloader.js - Baiscope Movie Downloader
const axios = require('axios');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'baiscope',
    description: 'Baiscope සිංහල චිත්‍රපට ඩවුන්ලෝඩ් කරන්න',
    category: 'චිත්‍රපට',
    
    async execute(message, args) {
        if (!args.length) {
            return message.reply(`🎬 *Baiscope චිත්‍රපට බොට්*
            
📌 *විධාන:*
• .baiscope <නම> - චිත්‍රපටය සොයන්න
• .baiscope download <url> - චිත්‍රපටය ඩවුන්ලෝඩ් කරන්න

📝 *උදාහරණ:*
.baiscope චෙරියෝ
.baiscope download https://baiscope.lk/movie/123

💡 *විශේෂත්වය:* ඩවුන්ලෝඩ් වෙන්නේ Document එකක් වගේ!`);
        }

        const command = args[0].toLowerCase();
        
        if (command === 'download') {
            const movieUrl = args[1];
            if (!movieUrl) {
                return message.reply('❌ කරුණාකර චිත්‍රපට URL එක ඇතුලත් කරන්න');
            }
            await this.downloadAsDocument(message, movieUrl);
        } else {
            await this.searchBaiscope(message, args.join(' '));
        }
    },

    // Baiscope එකෙන් සෙවීම
    async searchBaiscope(message, query) {
        try {
            message.reply(`🔍 "${query}" Baiscope එකෙන් සොයමින්...`);
            
            // Baiscope API එකට request එක
            const response = await axios.get(`https://baiscope.lk/api/search?q=${encodeURIComponent(query)}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            
            const movies = response.data.movies || [];
            
            if (movies.length === 0) {
                return message.reply(`❌ "${query}" සඳහා චිත්‍රපටයක් හමු නොවුනා`);
            }
            
            let responseText = `🎬 *Baiscope සෙවුම් ප්‍රතිඵල*\n\n`;
            movies.slice(0, 5).forEach((movie, index) => {
                responseText += `${index + 1}. *${movie.title}* (${movie.year})\n`;
                responseText += `   🎭 ${movie.genre || 'N/A'}\n`;
                responseText += `   🔗 ${movie.url}\n\n`;
            });
            
            responseText += `💡 බාගන්න: .baiscope download [url]`;
            
            await message.reply(responseText);
            
        } catch (error) {
            console.error('Search error:', error);
            message.reply('❌ සෙවීම අසාර්ථකයි');
        }
    },

    // Document එකක් වගේ චිත්‍රපටය ඩවුන්ලෝඩ් කරන්න
    async downloadAsDocument(message, movieUrl) {
        try {
            message.reply(`📥 චිත්‍රපටය Document එකක් ලෙස බාගනිමින්...

⏳ විනාඩි කිහිපයක් ගතවේවි. කරුණාකර රැඳී සිටින්න...`);
            
            // Baiscope එකෙන් චිත්‍රපට තොරතුරු ගන්න
            const movieInfo = await this.getBaiscopeMovieInfo(movieUrl);
            
            if (!movieInfo.downloadUrl) {
                return message.reply('❌ මෙම චිත්‍රපටය සඳහා ඩවුන්ලෝඩ් ලින්ක් එකක් නැත.');
            }
            
            // Direct URL එකෙන් චිත්‍රපටය බාගන්න
            const videoResponse = await axios({
                method: 'GET',
                url: movieInfo.downloadUrl,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Referer': 'https://baiscope.lk/'
                }
            });
            
            // ගොනුව සුරකින්න
            const fileName = `${movieInfo.title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
            const filePath = path.join(__dirname, '../downloads', fileName);
            
            // Downloads ෆෝල්ඩරය හදන්න
            if (!fs.existsSync(path.join(__dirname, '../downloads'))) {
                fs.mkdirSync(path.join(__dirname, '../downloads'));
            }
            
            const writer = fs.createWriteStream(filePath);
            videoResponse.data.pipe(writer);
            
            writer.on('finish', async () => {
                // Document එකක් විදියට WhatsApp එකට යවන්න
                await message.replyWithDocument(filePath, {
                    caption: `🎬 *${movieInfo.title}* (${movieInfo.year})
                    
📌 *Baiscope.lk*
⭐ *Rating:* ${movieInfo.rating || 'N/A'}/10
🎭 *Genre:* ${movieInfo.genre || 'N/A'}
⏱️ *Duration:* ${movieInfo.duration || 'N/A'}

💡 මෙය සිංහල සිනමා රන් යුගයේ චිත්‍රපටයකි.
📁 Document එකක් ලෙස සුරකින්න!`,
                    filename: `${movieInfo.title}.mp4`
                });
                
                // ගොනුව ඩිලීට් කරන්න (සේව් කරලා තියන්න අවශ්‍ය නම් මේක remove කරන්න)
                fs.unlinkSync(filePath);
            });
            
            writer.on('error', (err) => {
                console.error('Write error:', err);
                message.reply('❌ ගොනුව සුරැකීමේ දෝෂයක්');
            });
            
        } catch (error) {
            console.error('Download error:', error);
            message.reply('❌ ඩවුන්ලෝඩ් කිරීම අසාර්ථකයි');
        }
    },

    // Baiscope එකෙන් චිත්‍රපට තොරතුරු ගන්න
    async getBaiscopeMovieInfo(url) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            
            const $ = require('cheerio').load(response.data);
            
            return {
                title: $('h1').first().text().trim() || 'Baiscope Movie',
                year: $('.year').text().trim() || '2024',
                rating: $('.rating').text().trim(),
                genre: $('.genre').text().trim(),
                duration: $('.duration').text().trim(),
                downloadUrl: $('a.download-btn').attr('href') || $('source').attr('src')
            };
        } catch (error) {
            console.error('Info fetch error:', error);
            return { downloadUrl: null };
        }
    }
};
