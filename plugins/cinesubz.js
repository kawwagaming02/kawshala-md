const { cmd } = require("../command");
const { searchCineSubz, scrapeCineSubz, scrapeCineSubzServerLink } = require('cinesubz-scraper');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

// ============ SESSION STORAGE ============
const pendingSearch = {};
const pendingQuality = {};
const downloadProgress = {};

// ============ DOWNLOAD AND SEND MOVIE FUNCTION ============
async function downloadAndSendMovie(client, from, movieUrl, quality, m) {
    try {
        // Step 1: Get movie details
        const details = await scrapeCineSubz(movieUrl);
        
        if (!details.downloadLinks || details.downloadLinks.length === 0) {
            return { success: false, message: "No download links found" };
        }

        // Step 2: Find requested quality
        let selectedLink = null;
        
        // Try exact match
        for (const link of details.downloadLinks) {
            if (link.quality && link.quality.toLowerCase().includes(quality.toLowerCase())) {
                selectedLink = link;
                break;
            }
        }

        // If not found, try priority
        if (!selectedLink) {
            const priority = ['1080p', '720p', '480p', '360p'];
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

        // If still no link, take first
        if (!selectedLink) {
            selectedLink = details.downloadLinks[0];
        }

        // Step 3: Get download URL
        let downloadUrl = selectedLink.url || selectedLink.link || selectedLink.href;
        
        if (!downloadUrl || downloadUrl === 'undefined') {
            return { success: false, message: "Could not get download URL" };
        }

        // Step 4: Extract direct link if needed
        if (downloadUrl.includes('/go/') || downloadUrl.includes('/server/') || downloadUrl.includes('/link/')) {
            try {
                const directLink = await scrapeCineSubzServerLink(downloadUrl);
                if (directLink && directLink.startsWith('http')) {
                    downloadUrl = directLink;
                }
            } catch (e) {
                console.log('⚠️ Could not extract direct link, using original');
            }
        }

        // Step 5: Prepare file name and path
        const cleanTitle = details.title || 'Movie';
        const cleanQuality = selectedLink.quality || 'HD';
        const fileName = `${cleanTitle} - ${cleanQuality}.mp4`.replace(/[^\w\s.-]/gi, '');
        
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const filePath = path.join(tempDir, fileName);

        // Step 6: Send progress message
        await client.sendMessage(from, {
            text: `📥 *Downloading Movie*\n━━━━━━━━━━━━━━━━\n🎬 ${cleanTitle}\n📊 Quality: ${cleanQuality}\n💾 Size: ${selectedLink.size || 'Unknown'}\n\n⏳ Downloading... Please wait.`
        }, { quoted: m });

        // Step 7: Download file with progress
        const response = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream',
            timeout: 600000, // 10 minutes
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Referer': 'https://cinesubz.com/'
            }
        });

        // Check content length
        const contentLength = response.headers['content-length'];
        let totalSize = contentLength ? parseInt(contentLength) : 0;
        let downloadedSize = 0;
        let lastProgressUpdate = 0;

        // Download with progress tracking
        const writer = fs.createWriteStream(filePath);
        
        response.data.on('data', (chunk) => {
            downloadedSize += chunk.length;
            
            // Update progress every 5%
            const progress = totalSize ? (downloadedSize / totalSize) * 100 : 0;
            if (progress - lastProgressUpdate >= 5) {
                lastProgressUpdate = progress;
                const downloadedMB = (downloadedSize / (1024 * 1024)).toFixed(1);
                const totalMB = (totalSize / (1024 * 1024)).toFixed(1);
                console.log(`📥 Download progress: ${progress.toFixed(0)}% (${downloadedMB}MB / ${totalMB}MB)`);
            }
        });

        await streamPipeline(response.data, writer);

        // Step 8: Check file size
        const stats = fs.statSync(filePath);
        const fileSizeMB = stats.size / (1024 * 1024);
        
        console.log(`✅ Download complete: ${fileSizeMB.toFixed(2)} MB`);

        // Step 9: Check if file is too large
        if (fileSizeMB > 2000) {
            fs.unlinkSync(filePath);
            return { 
                success: false, 
                message: `File too large (${fileSizeMB.toFixed(2)} MB). WhatsApp limit is 2GB.` 
            };
        }

        // Step 10: Send as document (like in your screenshot)
        await client.sendMessage(from, {
            document: {
                url: filePath
            },
            mimetype: "video/mp4",
            fileName: fileName,
            caption: `🎬 *${cleanTitle}*\n📊 ${cleanQuality}\n💾 ${fileSizeMB.toFixed(2)} MB\n\n*Powered by KAWSHALA-MD*`
        }, { quoted: m });

        // Step 11: Clean up
        fs.unlinkSync(filePath);
        
        return { 
            success: true, 
            message: "Movie sent successfully!",
            fileSize: fileSizeMB.toFixed(2),
            fileName: fileName
        };

    } catch (error) {
        console.error("Download error:", error);
        // Clean up on error
        try {
            const tempDir = path.join(__dirname, 'temp');
            if (fs.existsSync(tempDir)) {
                const files = fs.readdirSync(tempDir);
                for (const file of files) {
                    const filePath = path.join(tempDir, file);
                    if (fs.statSync(filePath).isFile()) {
                        fs.unlinkSync(filePath);
                    }
                }
            }
        } catch (e) {}
        
        return { 
            success: false, 
            message: error.message || "Download failed" 
        };
    }
}

// ============ COMMAND: DOWNLOAD MOVIE ============
cmd({
    pattern: "download",
    alias: ["dl", "get", "movie", "film"],
    react: "📥",
    desc: "Search and download movies from CineSubz",
    category: "download"
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`📥 *Movie Downloader*\n━━━━━━━━━━━━━━━━\n\n*Usage:*\n• download movie_name\n• dl movie_name\n• get movie_name\n\n*Examples:*\n• download harry potter\n• dl avatar\n• get captain america\n\n*Specify quality:*\n• download harry potter 720p\n• dl avatar 1080p`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    // Parse command: "download movie_name quality"
    const parts = q.trim().split(/\s+/);
    const movieName = parts.slice(0, parts.length - 1).join(' ');
    const quality = parts[parts.length - 1].match(/^\d{3,4}p$/) ? parts[parts.length - 1] : '720p';
    const searchQuery = movieName || q;

    reply(`🔍 *Searching for "${searchQuery}"...*`);

    try {
        const results = await searchCineSubz(searchQuery);
        
        if (!results || results.length === 0) {
            return reply(`❌ *No movies found for "${searchQuery}"*`);
        }

        // If multiple results, show selection
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

        // If only one result, download directly
        const movie = results[0];
        const result = await downloadAndSendMovie(
            client, 
            from, 
            movie.url || movie.movieUrl, 
            quality,
            m
        );

        if (!result.success) {
            await client.sendMessage(from, {
                text: `❌ *Download Failed*\n━━━━━━━━━━━━━━━━\n${result.message}`
            }, { quoted: m });
        }

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

    reply(`📥 *Downloading ${selected.title}...*`);

    const result = await downloadAndSendMovie(
        client, 
        from, 
        selected.url || selected.movieUrl, 
        quality,
        m
    );

    if (!result.success) {
        await client.sendMessage(from, {
            text: `❌ *Download Failed*\n━━━━━━━━━━━━━━━━\n${result.message}`
        }, { quoted: m });
    }

    delete pendingSearch[sender];
});

// ============ COMMAND: DIRECT URL DOWNLOAD ============
cmd({
    pattern: "durl",
    alias: ["downloadurl", "dlurl"],
    react: "🔗",
    desc: "Download movie directly from URL",
    category: "download"
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`🔗 *Direct URL Download*\n━━━━━━━━━━━━━━━━\n\n*Usage:*\n• durl movie_url\n• downloadurl movie_url\n\n*Example:*\n• durl https://cinesubz.com/movie/harry-potter-2001\n\n*Specify quality:*\n• durl url 720p`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    const parts = q.trim().split(/\s+/);
    const url = parts[0];
    const quality = parts[1] || '720p';

    if (!url.startsWith('http')) {
        return reply(`❌ *Invalid URL!*`);
    }

    reply(`📥 *Downloading movie...*`);

    const result = await downloadAndSendMovie(
        client, 
        from, 
        url, 
        quality,
        m
    );

    if (!result.success) {
        await client.sendMessage(from, {
            text: `❌ *Download Failed*\n━━━━━━━━━━━━━━━━\n${result.message}`
        }, { quoted: m });
    }
});

// ============ COMMAND: GET MOVIE INFO ============
cmd({
    pattern: "info",
    alias: ["details", "movieinfo"],
    react: "ℹ️",
    desc: "Get movie details and download links",
    category: "download"
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`ℹ️ *Movie Info*\n━━━━━━━━━━━━━━━━\n\n*Usage:*\n• info movie_name\n• details movie_name\n\n*Example:*\n• info harry potter`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    try {
        const results = await searchCineSubz(q);
        
        if (!results || results.length === 0) {
            return reply(`❌ *No movies found for "${q}"*`);
        }

        const movie = results[0];
        const details = await scrapeCineSubz(movie.url || movie.movieUrl);

        let msg = `🎬 *${details.title || 'Movie'}*\n`;
        msg += `━━━━━━━━━━━━━━━━\n`;
        msg += `📅 Year: ${details.year || 'N/A'}\n`;
        msg += `📝 Language: ${details.language || 'N/A'}\n`;
        msg += `⭐ Rating: ${details.imdb || details.rating || 'N/A'}\n`;
        
        if (details.genres && details.genres.length > 0) {
            msg += `🎭 Genres: ${details.genres.join(', ')}\n`;
        }
        
        if (details.cast && details.cast.length > 0) {
            msg += `👥 Cast: ${details.cast.slice(0, 5).join(', ')}${details.cast.length > 5 ? '...' : ''}\n`;
        }
        
        if (details.description) {
            msg += `\n📖 Description:\n${details.description.substring(0, 200)}...\n`;
        }
        
        msg += `\n━━━━━━━━━━━━━━━━\n`;
        
        if (details.downloadLinks && details.downloadLinks.length > 0) {
            msg += `📥 *Available Qualities:*\n`;
            details.downloadLinks.slice(0, 5).forEach((link, i) => {
                msg += `*${i+1}.* ${link.quality || 'N/A'} - ${link.size || 'N/A'}\n`;
            });
            msg += `\n📌 *Type: download movie_name*`;
        } else {
            msg += `❌ *No download links available*`;
        }
        
        msg += `\n━━━━━━━━━━━━━━━━\n`;
        msg += `© POWERED BY KAWSHALA-MD`;

        if (details.thumbnail || details.poster) {
            await client.sendMessage(from, {
                image: { url: details.thumbnail || details.poster },
                caption: msg
            }, { quoted: m });
        } else {
            await client.sendMessage(from, { text: msg }, { quoted: m });
        }

    } catch (error) {
        console.error("Info error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
});

// ============ COMMAND: TRENDING ============
cmd({
    pattern: "trending",
    alias: ["popular", "top"],
    react: "🔥",
    desc: "Show trending movies",
    category: "download"
}, async (client, message, m, { from, reply }) => {
    await client.sendMessage(from, { 
        react: { text: "🔥", key: m.key } 
    });

    const trending = [
        "Harry Potter and the Philosopher's Stone",
        "Avatar",
        "Inception",
        "The Dark Knight",
        "Interstellar",
        "Avengers: Endgame",
        "The Lion King",
        "Frozen",
        "Captain America",
        "Spider-Man"
    ];

    let msg = `🔥 *Trending Movies*\n━━━━━━━━━━━━━━━━\n\n`;
    
    trending.forEach((movie, i) => {
        msg += `*${i+1}.* ${movie}\n`;
    });
    
    msg += `\n━━━━━━━━━━━━━━━━\n`;
    msg += `📌 *Type: download movie_name*\n`;
    msg += `© POWERED BY KAWSHALA-MD`;

    await client.sendMessage(from, { text: msg }, { quoted: m });
});

// ============ COMMAND: CLEAN TEMP ============
cmd({
    pattern: "cleantemp",
    alias: ["clearcache", "deletetemp"],
    react: "🧹",
    desc: "Clean temporary downloaded files",
    category: "utility"
}, async (client, message, m, { from, reply }) => {
    await client.sendMessage(from, { 
        react: { text: "🧹", key: m.key } 
    });

    try {
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            return reply(`🧹 *No temporary files found*`);
        }

        const files = fs.readdirSync(tempDir);
        let deletedCount = 0;
        let totalSize = 0;

        for (const file of files) {
            const filePath = path.join(tempDir, file);
            if (fs.statSync(filePath).isFile()) {
                const size = fs.statSync(filePath).size;
                totalSize += size;
                fs.unlinkSync(filePath);
                deletedCount++;
            }
        }

        reply(`🧹 *Cleanup Complete*\n━━━━━━━━━━━━━━━━\n✅ Files Deleted: ${deletedCount}\n💾 Space Freed: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);

    } catch (error) {
        console.error("Clean error:", error);
        reply(`❌ *Error cleaning temp files:* ${error.message}`);
    }
});

// ============ AUTO CLEANUP ============
setInterval(() => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000;
    
    for (const sender in pendingSearch) {
        if (now - pendingSearch[sender].timestamp > timeout) {
            delete pendingSearch[sender];
        }
    }
    
    // Clean temp files older than 1 hour
    try {
        const tempDir = path.join(__dirname, 'temp');
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stats = fs.statSync(filePath);
                const age = (now - stats.mtimeMs) / (1000 * 60);
                if (age > 60) { // Older than 1 hour
                    fs.unlinkSync(filePath);
                }
            }
        }
    } catch (e) {}
}, 5 * 60 * 1000);

// ============ EXPORT ============
module.exports = { 
    pendingSearch, 
    pendingQuality,
    downloadAndSendMovie
};
