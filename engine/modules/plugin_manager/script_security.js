const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Logger } = require('../utils.js');

class ScriptSecurity {
    constructor() {
        this.cachePath = null;
        this.allowlist = {};
    }

    async initialize(userDataPath) {
        if (!userDataPath) {
            throw new Error("ScriptSecurity requires userDataPath.");
        }
        this.cachePath = path.join(userDataPath, 'approved_scripts.json');
        await this.loadAllowlist();
    }

    async loadAllowlist() {
        if (!this.cachePath) return;
        try {
            const data = await fs.readFile(this.cachePath, 'utf8');
            this.allowlist = JSON.parse(data);
            Logger.log('ScriptSecurity', `Loaded ${Object.keys(this.allowlist).length} approved script hashes.`);
        } catch (e) {
            if (e.code === 'ENOENT') {
                this.allowlist = {};
                Logger.log('ScriptSecurity', `No allowlist found, created new one at ${this.cachePath}`);
            } else {
                Logger.error('ScriptSecurity', `Error loading allowlist: ${e.message}`);
                this.allowlist = {};
            }
        }
    }

    async saveAllowlist() {
        if (!this.cachePath) return;
        try {
            await fs.writeFile(this.cachePath, JSON.stringify(this.allowlist, null, 2), 'utf8');
        } catch (e) {
            Logger.error('ScriptSecurity', `Error saving allowlist: ${e.message}`);
        }
    }

    hashContent(content) {
        if (typeof content !== 'string') {
            throw new TypeError('Story Script content must be a string.');
        }
        const normalizedContent = content.replace(/\r\n/g, '\n');
        return crypto.createHash('sha256').update(normalizedContent).digest('hex');
    }

    /**
     * Reads and hashes the exact content that will later be executed.
     */
    async readScript(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return { content, hash: this.hashContent(content) };
        } catch (e) {
            Logger.error('ScriptSecurity', `Error reading Story Script ${filePath}: ${e.message}`);
            return null;
        }
    }

    async calculateHash(filePath) {
        const script = await this.readScript(filePath);
        return script?.hash || null;
    }

    isHashApproved(hash) {
        return !!this.allowlist[hash];
    }

    /**
     * Approves a specific hash, adding it to the allowlist.
     * @param {string} hash - The SHA-256 hash.
     * @param {Object} metadata - Optional metadata about the script (e.g. filename, project).
     */
    async approveHash(hash, metadata = {}) {
        if (!process.env.TEST_MODE) {
           this.allowlist[hash] = {
               approvedAt: new Date().toISOString(),
               ...metadata
           };
           await this.saveAllowlist();
           Logger.log('ScriptSecurity', `Hash approved and saved: ${hash}`);
        }
    }
}

module.exports = new ScriptSecurity();
