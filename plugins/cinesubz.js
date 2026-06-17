const { cmd } = require("../command");
const { searchCineSubz, scrapeCineSubz, scrapeCineSubzServerLink } = require('cinesubz-scraper');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============ SESSION STORAGE ============
const pendingSearch = {};
const downloadProgress = {};

// ============ GET DIRECT DOWNLOAD URL ============
async function getDirectDownloadUrl(linkUrl) {
    try {
        console.log(`🔍 Getting direct URL from: ${linkUrl}`);
        
        // Method 1: Try with cinesubz-scraper
        try {
            const directLink = await scrapeCineSubzServerLink(linkUrl);
            if (directLink && directLink.startsWith('http') && !directLink.includes('undefined')) {
                console.log(`✅ Found via scraper: ${directLink}`);
                return directLink;
            }
        } catch (e) {
            console.log('⚠️ Scraper failed');
        }

        // Method 2: Follow redirects
        try {
            const response = await axios.get(linkUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                maxRedirects: 5,
                timeout: 30000,
                validateStatus: () => true
            });

            // Check if redirect
            if (response.status === 302 || response.status === 301) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    console.log(`🔄 Redirect to: ${redirectUrl}`);
                    return await getDirectDownloadUrl(redirectUrl);
                }
            }

            // Check content-type
            const contentType = response.headers['content-type'] || '';
            if (contentType.includes('video') || contentType.includes('octet-stream')) {
                console.log(`✅ Found video: ${linkUrl}`);
                return linkUrl;
            }

        } catch (e) {
            console.log('⚠️ Redirect check failed');
        }

        return linkUrl;

    } catch (error) {
        console.error('❌ Error:', error);
        return linkUrl;
    }
}

// ============ DOWNLOAD AND SEND FULL MOVIE ============
async function downloadFullMovie(client, from, downloadUrl, fileName, caption, m) {
    try {
        // Get direct download URL
        const directUrl = await getDirectDownloadUrl(downloadUrl);
        
        if (!directUrl || directUrl === 'undefined') {
            return { 
                success: false, 
                message: "Could not find valid download URL" 
            };
        }

        console.log(`✅ Direct URL: ${directUrl}`);

        // Create temp directory
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const filePath = path.join(tempDir, fileName);

        // Check if file already exists (resume support)
        let existingSize = 0;
        if (fs.existsSync(filePath)) {
            existingSize = fs.statSync(filePath).size;
            console.log(`📊 Existing file size: ${(existingSize / (1024 * 1024)).toFixed(2)} MB`);
        }

        // Send progress message
        await client.sendMessage(from, {
            text: `📥 *Downloading Full Movie*\n━━━━━━━━━━━━━━━━\n🎬 ${fileName.replace('.mp4', '')}\n💾 Please wait... This may take 10-15 minutes.\n\n⏳ Starting download...`
        }, { quoted: m });

        // Download with range support (resume)
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'video/mp4,video/*,*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
        };

        if (existingSize > 0) {
            headers['Range'] = `bytes=${existingSize}-`;
        }

        const response = await axios({
            method: 'GET',
            url: directUrl,
            responseType: 'stream',
            timeout: 900000, // 15 minutes
            headers: headers,
            maxRedirects: 5
        });

        // Check content type
        const contentType = response.headers['content-type'] || '';
        const contentLength = response.headers['content-length'] || 0;
        const totalSize = contentLength > 0 ? parseInt(contentLength) + existingSize : 0;

        console.log(`📊 Content-Type: ${contentType}`);
        console.log(`📊 Total Size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);

        // Check if it's a video
        if (!contentType.includes('video') && !contentType.includes('octet-stream')) {
            return {
                success: false,
                message: `Invalid content type: ${contentType}. Not a video file.`
            };
        }

        // Check file size
        if (totalSize > 0 && totalSize < 1000000) {
            return {
                success: false,
                message: `File too small (${(totalSize/1024).toFixed(1)} KB). Not a valid video.`
            };
        }

        // Check if file exceeds WhatsApp limit
        if (totalSize > 2.1 * 1024 * 1024 * 1024) { // 2.1GB
            return {
                success: false,
                message: `File too large (${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB). WhatsApp limit is 2GB.`
            };
        }

        // Download with progress
        const writer = fs.createWriteStream(filePath, { flags: existingSize > 0 ? 'a' : 'w' });
        let downloadedSize = existingSize;
        let lastUpdate = 0;

        response.data.on('data', (chunk) => {
            downloadedSize += chunk.length;
            
            // Update progress every 10MB
            if (downloadedSize - lastUpdate > 10 * 1024 * 1024) {
                lastUpdate = downloadedSize;
                const progress = totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0;
                const downloadedMB = (downloadedSize / (1024 * 1024)).toFixed(1);
                const totalMB = (totalSize / (1024 * 1024)).toFixed(1);
                console.log(`📥 Progress: ${progress.toFixed(1)}% (${downloadedMB}MB / ${totalMB}MB)`);
            }
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                try {
                    const stats = fs.statSync(filePath);
                    const fileSizeMB = stats.size / (1024 * 1024);
                    
                    console.log(`✅ Download complete: ${fileSizeMB.toFixed(2)} MB`);

                    // Check if file is valid
                    if (fileSizeMB < 50) { // Less than 50MB
                        fs.unlinkSync(filePath);
                        resolve({ 
                            success: false, 
                            message: `File too small (${fileSizeMB.toFixed(2)} MB). Download may have failed.` 
                        });
                        return;
                    }

                    if (fileSizeMB > 2000) {
                        fs.unlinkSync(filePath);
                        resolve({ 
                            success: false, 
                            message: `File too large (${fileSizeMB.toFixed(2)} MB). WhatsApp limit is 2GB.` 
                        });
                        return;
                    }

                    // Send progress update
                    await client.sendMessage(from, {
                        text: `📤 *Sending Movie...*\n━━━━━━━━━━━━━━━━\n📊 File Size: ${fileSizeMB.toFixed(2)} MB\n⏳ Uploading to WhatsApp...`
                    }, { quoted: m });

                    // Send the file
                    await client.sendMessage(from, {
                        document: {
                            url: filePath
                        },
                        mimetype: "video/mp4",
                        fileName: fileName,
                        caption: caption
                    }, { quoted: m });

                    // Delete temp file
                    fs.unlinkSync(filePath);
                    
                    resolve({ 
                        success: true, 
                        message: "Full movie sent successfully!",
                        size: fileSizeMB.toFixed(2)
                    });

                } catch (error) {
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

// ============ DOWNLOAD MOVIE ============
async function downloadMovieFile(client, from, movie, quality, m, reply) {
    try {
        // Get movie details
        const details = await scrapeCineSubz(movie.url || movie.movieUrl);
        
        if (!details.downloadLinks || details.downloadLinks.length === 0) {
            return reply(`❌ *No download links found for this movie*`);
        }

        // Find quality
        let selectedLink = null;
        for (const link of details.downloadLinks) {
            if (link.quality && link.quality.toLowerCase().includes(quality.toLowerCase())) {
                selectedLink = link;
                break;
            }
        }

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
        
        console.log(`📥 Selected link: ${downloadUrl}`);

        if (!downloadUrl || downloadUrl === 'undefined' || downloadUrl === 'null') {
            return reply(`❌ *Could not get download URL*\n\nTry another quality or movie.`);
        }

        // Prepare file name
        const cleanTitle = details.title || movie.title || 'Movie';
        const cleanQuality = selectedLink.quality || quality;
        const fileName = `${cleanTitle} - ${cleanQuality}.mp4`.replace(/[^\w\s.-]/gi, '');

        // Download full movie
        const result = await downloadFullMovie(
            client,
            from,
            downloadUrl,
            fileName,
            `🎬 *${cleanTitle}*\n📊 ${cleanQuality}\n💾 ${selectedLink.size || 'N/A'}\n\n*Full Movie Downloaded*\n*Powered by Zanta Bot*`,
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

// ============ MAIN COMMAND ============
cmd({
    pattern: "cs",
    alias: ["cinesubz", "movie", "film"],
    react: "🎬",
    desc: "CineSubz එකෙන් සම්පූර්ණ චිත්‍රපටය බාගන්න",
    category: "download",
    filename: __filename
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`🎬 *CineSubz Full Movie Downloader*

*භාවිතය:*
• cs චිත්‍රපට_නම
• movie චිත්‍රපට_නම

*උදාහරණ:*
• cs harry potter
• movie avatar
• cs captain america 720p

*Quality එකත් දාන්න පුළුවන්:*
• cs harry potter 1080p
• cs avatar 720p

⚠️ *සටහන:* WhatsApp limit එක 2GB නිසා 2GB ට වැඩි files send වෙන්නේ නැහැ.`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

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
        const results = await searchCineSubz(movieName);
        
        if (!results || results.length === 0) {
            return reply(`❌ *No movies found for "${movieName}"*`);
        }

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

// ============ AUTO CLEANUP ============
setInterval(() => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000;
    
    for (const sender in pendingSearch) {
        if (now - pendingSearch[sender].timestamp > timeout) {
            delete pendingSearch[sender];
        }
    }

    try {
        const tempDir = path.join(__dirname, 'temp');
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stats = fs.statSync(filePath);
                const age = (now - stats.mtimeMs) / (1000 * 60);
                if (age > 60) {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Deleted old temp file: ${file}`);
                }
            }
        }
    } catch (e) {}
}, 5 * 60 * 1000);

module.exports = { pendingSearch };
