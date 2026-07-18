const sharp = require('sharp');
const path = require('path');
const { Logger } = require('../../utils.js');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs').promises;

/**
 * Generates a thumbnail for a given turn.
 * @param {TurnContext} turnContext - The context of the current turn.
 * @returns {Promise<string|null>} A base64 encoded JPG string, or null if generation fails.
 */
async function generateThumbnail(turnContext) {
    // 1. Check for Plugin Override
    if (turnContext.runtime && turnContext.runtime.thumbnailOverride) {
        Logger.log('ThumbnailGen', 'Using plugin override for thumbnail');
        let base64Image = turnContext.runtime.thumbnailOverride;
        // Strip data URI prefix if present
        if (base64Image.startsWith('data:image')) {
            base64Image = base64Image.replace(/^data:image\/\w+;base64,/, '');
        }
        return base64Image;
    }

    const projectRootDir = turnContext.runtime?.rootDirectory || process.cwd();

    /**
     * Helper to resolve an asset path against the project's root directory.
     * Handles:
     * 1. Full absolute paths.
     * 2. Frontend-style paths starting with 'projects/[ProjectName]/'.
     * 3. Paths starting with 'assets/' or 'plugins/'.
     * 4. Relativized paths (e.g. 'backgrounds/room.webp') which implicitly assume 'assets/'.
     */
    const resolveAsset = async (assetPath) => {
        if (!assetPath) return null;
        if (path.isAbsolute(assetPath)) return assetPath;
        
        let normalizedPath = assetPath.replace(/\\/g, '/');
        
        // Strip ?v= cache buster if present (redundant here but safe)
        normalizedPath = normalizedPath.split('?')[0];

        // Strip leading /
        if (normalizedPath.startsWith('/')) normalizedPath = normalizedPath.substring(1);

        // Strip leading ../ jumps and redundant workspace/projects prefixes
        // These are often present in frontend-ready URLs but redundant for backend FS resolution
        // against projectRootDir.
        normalizedPath = normalizedPath.replace(/^(\.\.\/)+/, '');
        normalizedPath = normalizedPath.replace(/^workspace\/projects\/[^/]+\//i, '');
        normalizedPath = normalizedPath.replace(/^projects\/[^/]+\//i, '');
        
        // 1. If it already starts with assets/ or plugins/, resolve against projectRootDir directly
        if (normalizedPath.startsWith('assets/') || normalizedPath.startsWith('plugins/')) {
            return path.join(projectRootDir, normalizedPath);
        }
        
        // 2. Default: projectRootDir/assets/assetPath (standard relativized path)
        return path.join(projectRootDir, 'assets', normalizedPath);
    };

    // 2. Check for CG in the sequence
    const sequence = turnContext.output.sequence || [];
    const cgScene = sequence.find(scene => scene.cg);

    if (cgScene && cgScene.cg) {
        Logger.log('ThumbnailGen', `Found CG: ${cgScene.cg}, generating CG thumbnail.`);
        try {
            const cleanCgPath = cgScene.cg.split('?')[0]; // Strip ?v= cache buster
            const absCgPath = await resolveAsset(cleanCgPath);
            Logger.log('ThumbnailGen', `Resolved CG path: ${absCgPath}`);
            
            const cgBuffer = await sharp(absCgPath)
                .resize(320, 180, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toBuffer();
            return cgBuffer.toString('base64');
        } catch (error) {
            Logger.error('ThumbnailGen', `Failed to generate CG thumbnail from ${cgScene.cg}`, error);
            // Fall through to normal generation
        }
    }

    // 3. Normal Background + Sprites Generation
    const backgroundPath = turnContext.output.finalBackground;
    const prominentSprites = turnContext.output.prominentSprites || [];

    if (!backgroundPath) {
        Logger.warn('ThumbnailGen', 'Missing background, skipping normal thumbnail generation.');
        return null;
    }

    let tempFramePath = null;
    try {
        const absBackgroundPath = await resolveAsset(backgroundPath);
        const isVideo = absBackgroundPath.toLowerCase().endsWith('.mp4') || absBackgroundPath.toLowerCase().endsWith('.webm');

        let imageInput = absBackgroundPath;

        if (isVideo) {
            tempFramePath = path.join(os.tmpdir(), `vn_thumb_${crypto.randomUUID()}.jpg`);
            Logger.log('ThumbnailGen', `Extracting frame from video background: ${absBackgroundPath}`);
            await new Promise((resolve, reject) => {
                execFile(ffmpegPath, [
                    '-ss', '00:00:00.500',
                    '-i', absBackgroundPath,
                    '-vframes', '1',
                    '-q:v', '2',
                    tempFramePath
                ], (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            imageInput = tempFramePath;
        }

        // 1. Initialize background
        let image = sharp(imageInput)
            .resize(320, 180, { fit: 'cover' });

        const spriteComposites = [];
        const spriteCount = prominentSprites.length;

        // 2. Define positions (x-coordinates for 320px width)
        let positions = [];
        if (spriteCount === 1) {
            positions = [160]; // Center
        } else if (spriteCount === 2) {
            positions = [80, 240]; // 25%, 75%
        } else if (spriteCount === 3) {
            positions = [48, 160, 272]; // 15%, 50%, 85%
        }

        // 3. Process sprites
        for (let i = 0; i < spriteCount; i++) {
            const spritePath = prominentSprites[i];
            const absSpritePath = await resolveAsset(spritePath);

            try {
                // Resize sprite to a max height of 160px (leaving some margin)
                const spriteBuffer = await sharp(absSpritePath)
                    .resize({ height: 160, fit: 'inside' })
                    .toBuffer();

                const metadata = await sharp(spriteBuffer).metadata();

                spriteComposites.push({
                    input: spriteBuffer,
                    top: 180 - metadata.height, // Place at the bottom
                    left: Math.round(positions[i] - (metadata.width / 2))
                });
            } catch (err) {
                Logger.error('ThumbnailGen', `Failed to process sprite: ${spritePath} at resolved path: ${absSpritePath}`, err);
            }
        }

        // 4. Composite and convert to Base64
        const finalBuffer = await image
            .composite(spriteComposites)
            .jpeg({ quality: 70 })
            .toBuffer();

        if (tempFramePath) {
            try { await fs.unlink(tempFramePath); } catch { }
        }

        return finalBuffer.toString('base64');

    } catch (error) {
        if (tempFramePath) {
            try { await fs.unlink(tempFramePath); } catch { }
        }
        Logger.error('ThumbnailGen', `Failed to generate thumbnail for background: ${backgroundPath}`, error);
        return null;
    }
}

module.exports = {
    generateThumbnail
};
