const { cmd } = require("../command");
const { searchCineSubz, scrapeCineSubz, scrapeCineSubzServerLink } = require('cinesubz-scraper');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============ SESSION STORAGE ============
const pendingSearch = {};

// ============ DOWNLOAD AND SEND FILE ============
async function downloadAndSendFile(client, from, downloadUrl, fileName, caption, m) {
    try {
        // Create temp directory
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const filePath = path.join(tempDir, fileName);
        
        console.log(`📥 Downloading: ${fileName}`);
        console.log(`📥 From: ${downloadUrl}`);

        // Send progress message
        await client.sendMessage(from, {
            text: `📥 *Downloading Movie File*\n━━━━━━━━━━━━━━━━\n⏳ Please wait... This may take a few minutes.`
        }, { quoted: m });

        // Download the file
        const response = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream',
            timeout: 600000, // 10 minutes
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            }
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                try {
                    // Check file size
                    const stats = fs.statSync(filePath);
                    const fileSizeMB = stats.size / (1024 * 1024);
                    
                    console.log(`✅ Download complete: ${fileSizeMB.toFixed(2)} MB`);

                    // Check if file is too large (WhatsApp limit: 2GB)
                    if (fileSizeMB > 2000) {
                        fs.unlinkSync(filePath);
                        resolve({ 
                            success: false, 
                            message: `File too large (${fileSizeMB.toFixed(2)} MB). WhatsApp limit is 2GB.` 
                        });
                        return;
                    }

                    // Send the file to WhatsApp
                    await client.sendMessage(from, {
                        document: {
                            url: filePath
                        },
                        mimetype: "video/mp4",
                        fileName: fileName,
                        caption: caption
                    }, { quoted: m });

                    // Delete temp file after sending
                    fs.unlinkSync(filePath);
                    
                    resolve({ 
                        success: true, 
                        message: "File sent successfully!",
                        size: fileSizeMB.toFixed(2)
                    });

                } catch (error) {
                    // Clean up on error
                    try { fs.unlinkSync(filePath); } catch (e) {}
                    reject(error);
                }
            });

            writer.on('error', (error) => {
                try { fs.unlinkSync(filePath); } catch (e) {}
                reject(error);
            });
        });

    } catch (error) {
        console.error("Download error:", error);
        return { 
            success: false, 
            message: error.message || "Download failed" 
        };
    }
}

// ============ MAIN COMMAND ============
cmd({
    pattern: "cs",
    alias: ["cinesubz", "movie", "film"],
    react: "🎬",
    desc: "CineSubz එකෙන් චිත්‍රපට File එක බාගන්න",
    category: "download",
    filename: __filename
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`🎬 *CineSubz Movie Downloader*

*භාවිතය:*
• cs චිත්‍රපට_නම
• movie චිත්‍රපට_නම

*උදාහරණ:*
• cs harry potter
• movie avatar
• cs captain america 720p

*Quality එකත් දාන්න පුළුවන්:*
• cs harry potter 1080p
• cs avatar 720p`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    // Parse quality
    const parts = q.trim().split(/\s+/);
    let movieName = q;
    let quality = '720p';

    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.match(/^\d{3,4}p$/)) {
        movieName = parts.slice(0, -1).join(' ');
        quality = lastPart;
    }

    reply(`🔍 *Searching for "${movieName}"...*`);

    try {
        // Step 1: Search for the movie
        const results = await searchCineSubz(movieName);
        
        if (!results || results.length === 0) {
            return reply(`❌ *No movies found for "${movieName}"*`);
        }

        // Step 2: Show search results
        if (results.length > 1) {
            pendingSearch[sender] = { 
                results: results, 
                quality: quality,
                timestamp: Date.now() 
            };

            let msg = `🎬 *Search Results*\n━━━━━━━━━━━━━━━━\n\n`;
            const displayCount = Math.min(8, results.length);
            
            for (let i = 0; i < displayCount; i++) {
                const movie = results[i];
                msg += `*${i+1}.* ${movie.title || 'N/A'}\n`;
                msg += `   📊 ${movie.quality || 'N/A'}\n`;
                msg += `   📝 ${movie.language || 'N/A'}\n\n`;
            }
            
            msg += `━━━━━━━━━━━━━━━━\n`;
            msg += `📌 *Reply with number (1-${displayCount})*\n`;
            msg += `⏱️ *Expires in 5 minutes*`;

            await client.sendMessage(from, { text: msg }, { quoted: m });
            return;
        }

        // Step 3: If only one result, download directly
        const movie = results[0];
        await downloadMovieFile(client, from, movie, quality, m, reply);

    } catch (error) {
        console.error("Download error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
});

// ============ HANDLE SEARCH SELECTION ============
cmd({
    filter: (text, { sender }) => {
        if (!pendingSearch[sender]) return false;
        const num = parseInt(text.trim());
        return !isNaN(num) && num > 0 && num <= pendingSearch[sender].results.length;
    }
}, async (client, message, m, { body, sender, reply, from }) => {
    await client.sendMessage(from, { 
        react: { text: "✅", key: m.key } 
    });

    const index = parseInt(body.trim()) - 1;
    const { results, quality } = pendingSearch[sender];
    const selected = results[index];

    await downloadMovieFile(client, from, selected, quality, m, reply);
    
    delete pendingSearch[sender];
});

// ============ DOWNLOAD MOVIE FILE FUNCTION ============
async function downloadMovieFile(client, from, movie, quality, m, reply) {
    try {
        reply(`📥 *Getting download links for ${movie.title}...*`);

        // Get movie details
        const details = await scrapeCineSubz(movie.url || movie.movieUrl);
        
        if (!details.downloadLinks || details.downloadLinks.length === 0) {
            return reply(`❌ *No download links found for this movie*`);
        }

        // Find requested quality
        let selectedLink = null;
        for (const link of details.downloadLinks) {
            if (link.quality && link.quality.toLowerCase().includes(quality.toLowerCase())) {
                selectedLink = link;
                break;
            }
        }

        // If quality not found, take the first available
        if (!selectedLink) {
            const priority = ['1080p', '720p', '480p'];
            for (const q of priority) {
                for (const link of details.downloadLinks) {
                    if (link.quality && link.quality.toLowerCase().includes(q)) {
                        selectedLink = link;
                        break;
                    }
                }
                if (selectedLink) break;
            }
        }

        if (!selectedLink) {
            selectedLink = details.downloadLinks[0];
        }

        // Get download URL
        let downloadUrl = selectedLink.url || selectedLink.link || selectedLink.href;
        
        if (!downloadUrl || downloadUrl === 'undefined') {
            return reply(`❌ *Could not get download URL*`);
        }

        // Extract direct link if needed
        if (downloadUrl.includes('/go/') || downloadUrl.includes('/server/') || downloadUrl.includes('/link/')) {
            try {
                const directLink = await scrapeCineSubzServerLink(downloadUrl);
                if (directLink && directLink.startsWith('http')) {
                    downloadUrl = directLink;
                }
            } catch (e) {
                console.log('⚠️ Could not extract direct link');
            }
        }

        // Prepare file name
        const cleanTitle = details.title || movie.title || 'Movie';
        const cleanQuality = selectedLink.quality || quality;
        const fileName = `${cleanTitle} - ${cleanQuality}.mp4`.replace(/[^\w\s.-]/gi, '');

        // Send progress message
        await client.sendMessage(from, {
            text: `📥 *Downloading*\n━━━━━━━━━━━━━━━━\n🎬 ${cleanTitle}\n📊 ${cleanQuality}\n💾 ${selectedLink.size || 'Unknown'}\n\n⏳ Please wait... This may take a few minutes.`
        }, { quoted: m });

        // Download and send file
        const result = await downloadAndSendFile(
            client,
            from,
            downloadUrl,
            fileName,
            `🎬 *${cleanTitle}*\n📊 ${cleanQuality}\n💾 ${selectedLink.size || 'N/A'}\n\n*Powered by Zanta Bot*`,
            m
        );

        if (!result.success) {
            reply(`❌ *Download Failed*\n━━━━━━━━━━━━━━━━\n${result.message}`);
        }

    } catch (error) {
        console.error("Download error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
}

// ============ AUTO CLEANUP ============
setInterval(() => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000;
    
    for (const sender in pendingSearch) {
        if (now - pendingSearch[sender].timestamp > timeout) {
            delete pendingSearch[sender];
        }
    }

    // Clean temp files older than 30 minutes
    try {
        const tempDir = path.join(__dirname, 'temp');
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stats = fs.statSync(filePath);
                const age = (now - stats.mtimeMs) / (1000 * 60);
                if (age > 30) {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Deleted old temp file: ${file}`);
                }
            }
        }
    } catch (e) {}
}, 5 * 60 * 1000);

// ============ EXPORT ============
module.exports = { 
    pendingSearch
};
