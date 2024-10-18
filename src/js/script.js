// Add this function at the top of your script, outside of any class
function applyCase(word, casing) {
    if (!word) return '';
    switch (casing) {
        case 'uc': return word.toUpperCase();
        case 'lc': return word.toLowerCase();
        case 'ic': return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        case 'sp': return word.split('').map((char, i) => i % 2 === 0 ? char.toUpperCase() : char.toLowerCase()).join('');
        default: return word;
    }
}

class WFont {
    constructor(name, url, style = null) {
        this.name = name;
        this.url = url;
        this.style = style;
        this.fullFontName = url ? name : `${name} ${style}`.trim();
        this.loading = false;
        this.loaded = false;
        this.error = false;
        this.computed = null;

        this.load();
    }

    async load() {
        try {
            this.loaded = false;
            this.loading = true;

            if (this.url) {
                // Load uploaded font
                const font = new FontFace(this.name, `url(${this.url})`);
                await font.load();
                document.fonts.add(font);
            } else {
                // For local fonts, we'll just check if it's available
                await this.checkLocalFont();
            }

            this.loaded = true;
            waterfall.computeIfReady();
        } catch (error) {
            this.error = error;
            console.error('Error loading font:', error);
        } finally {
            this.loading = false;
        }
    }

    async checkLocalFont() {
        const testString = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        ctx.font = `12px "${this.fullFontName}"`;
        await document.fonts.load(ctx.font);
        const width = ctx.measureText(testString).width;

        if (width <= 0) {
            throw new Error(`Font "${this.fullFontName}" not available`);
        }
    }

    compute(wordlist, casing, granularity) {
        const lengths = {};
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        ctx.font = `${waterfall.fontSize}px "${this.fullFontName}"`;

        for (const word of wordlist) {
            if (!word) continue;
            
            let casedWord = applyCase(word, casing);
            if (!casedWord) continue;
            
            let width = ctx.measureText(casedWord).width;
            let length = Math.ceil(width / granularity) * granularity;
            
            if (!(length in lengths)) {
                lengths[length] = [];
            }
            
            if (!lengths[length].includes(casedWord)) {
                lengths[length].push(casedWord);
            }
        }

        this.computed = lengths;
        waterfall.updateUI();
    }
}

class Waterfall {
    constructor() {
        this.done = false;
        this.fontSize = 60;
        this.lineHeight = 1; // Add this line
        this.casing = 'ic'; // Default casing
        this.granularity = 5;
        this.resultsCount = 10; // Default value
        this._runlength = 500; // Default value
        this.seed = 1;
        this.shiftMode = false;
        this.targetWord = '';

        this.dict = {
            loading: false,
            loaded: false,
            error: false,
            manual: false,
            dict: null
        };

        this.fonts = [];

        this.init();
        this.fontInput = new FontInput(this);

        this.currentResultsCount = 0;
        this.currentFont = null; // Add this to keep track of the current font
    }

    init() {
        this.loadDict();
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.addEventListener("keydown", event => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.keyCode === 16) this.shiftMode = true;
        });

        document.addEventListener("keyup", event => {
            if (event.keyCode === 16) this.shiftMode = false;
        });

        const runlengthInput = document.getElementById('runlength');
        if (runlengthInput) {
            runlengthInput.addEventListener('input', (e) => {
                this.runlength = parseInt(e.target.value);
                this.updateUI();
            });
        }

        const casingSelect = document.getElementById('casing');
        if (casingSelect) {
            casingSelect.addEventListener('change', (e) => {
                this.casing = e.target.value;
                this.computeIfReady();
            });
        }

        const targetWordInput = document.getElementById('targetWord');
        if (targetWordInput) {
            targetWordInput.addEventListener('input', (e) => {
                const word = e.target.value.trim();
                this.updateRunlengthFromWord(word);
            });
        }

        const fontUploader = document.getElementById('fontUploader');
        if (fontUploader) {
            fontUploader.addEventListener('change', (event) => {
                this.loadFonts(event.target.files);
            });
        }

        const dictUploader = document.getElementById('dictUploader');
        if (dictUploader) {
            dictUploader.addEventListener('change', (event) => {
                this.loadDict(event.target.files[0]);
            });
        }

        const resultsCountDisplay = document.getElementById('resultsCountDisplay');
        
        if (resultsCountDisplay) {
            resultsCountDisplay.textContent = this.resultsCount;
            this.updateUI();
        }
    }

    async loadDict(source) {
        try {
            this.dict.dict = null;
            this.dict.loaded = false;
            this.dict.error = false;
            this.dict.loading = true;

            let text;
            if (source) {
                this.dict.manual = true;
                if (!source.name.endsWith('.txt')) {
                    throw new Error("Dictionary file must be .txt. (Reverting to default.)");
                }
                text = await source.text();
            } else {
                this.dict.manual = false;
                const response = await fetch('dist/words.txt');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                text = await response.text();
            }

            this.dict.dict = text.split(/\r?\n/);
            this.dict.loaded = true;
            this.computeIfReady();
        } catch (err) {
            console.error("Error loading dictionary:", err);
            this.dict.error = err.message;
        } finally {
            this.dict.loading = false;
        }
    }

    removeFont(filename) {
        this.fonts = this.fonts.filter(font => font.file.name !== filename);
    }

    async loadFonts(source) {
        for (let i = 0; i < source.length; i++) {
            const f = new WFont(source[i]);
            this.fonts.push(f);
        }

    }

    refresh() {
        this.seed++;
        this.computeIfReady();
        this.updateUI();
    }

    computeIfReady() {
        const allFontsLoaded = this.fonts.every(font => font.loaded);
        if (allFontsLoaded && this.dict.loaded) {
            this.compute();
        }
    }

    compute() {
        console.log("computing");
        for (const font of this.fonts) {
            font.compute(this.dict.dict, this.casing, this.granularity);
        }
        this.done = true;
        this.updateUI();
    }

    updateLengthFromWord() {
        if (this.targetWord && this.fonts.length > 0) {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            context.font = `${this.fontSize}px ${this.fonts[0].reference}`;
            const width = context.measureText(this.targetWord).width;
            this.runlength = Math.round(width);
            this.refresh();
        }
    }

    updateRunlengthFromWord(word) {
        if (!this.currentFont || !word) return;

        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        ctx.font = `${this.fontSize}px "${this.currentFont.fullFontName}"`;

        const width = ctx.measureText(word).width;
        const newRunlength = Math.ceil(width);

        this.runlength = newRunlength; // This will trigger the setter
    }

    updateUI() {
        const runlengthInput = document.getElementById('runlength');
        const runlengthDisplay = document.getElementById('runlengthDisplay');
        const resultsCountDisplay = document.getElementById('resultsCountDisplay');
        const resultsContainer = document.getElementById('results');

        if (runlengthInput) runlengthInput.value = this.runlength;
        if (runlengthDisplay) runlengthDisplay.textContent = this.runlength;

        if (resultsContainer) {
            resultsContainer.innerHTML = '';
            this.currentResultsCount = 0;
            
            for (const font of this.fonts) {
                if (font.computed) {
                    this.currentFont = font;
                    const results = font.computed[this.quantizedRunlength] || [];
                    this.currentResultsCount = results.length;
                    
                    const fontElement = document.createElement('div');
                    fontElement.style.fontFamily = `"${font.fullFontName}"`;
                    fontElement.style.fontSize = `${this.fontSize}px`;
                    fontElement.style.lineHeight = this.lineHeight;
                    
                    if (results.length > 0) {
                        fontElement.innerHTML = results.join('<br>');
                    } else {
                        fontElement.innerHTML = this.getPlaceholderText(font.fullFontName);
                        fontElement.style.color = '#888'; // Grey color for placeholder
                        fontElement.style.fontStyle = 'italic';
                    }
                    
                    resultsContainer.appendChild(fontElement);
                }
            }
        }

        if (resultsCountDisplay) {
            resultsCountDisplay.textContent = this.currentResultsCount;
        }

        // Update other UI elements as needed
    }

    get quantizedRunlength() {
        return Math.ceil(this._runlength / this.granularity) * this.granularity;
    }

    get shiftStep() {
        return this.shiftMode ? 10 : 1;
    }

    addFont(name, url) {
        const newFont = new WFont(name, url);
        this.fonts.push(newFont);
        this.computeIfReady();
    }

    addLocalFont(family, style) {
        const newFont = new WFont(family, null, style);
        this.fonts = [newFont]; // Replace existing fonts with the new local font
        this.computeIfReady();
    }

    getFontWeight(style) {
        if (style && style.toLowerCase().includes('bold')) {
            return 'bold';
        }
        return 'normal';
    }

    get runlength() {
        return this._runlength;
    }

    set runlength(value) {
        this._runlength = value;
        // You might want to trigger some updates here
        this.updateUI();
    }

    getPlaceholderText(fontName) {
        return `...`;
    }
}

class FontInput {
    constructor(waterfall) {
        this.waterfall = waterfall;
        this.fontUpload = document.getElementById('fontUpload');
        this.loadLocalFontsButton = document.getElementById('loadLocalFonts');
        this.fontSelectors = document.getElementById('fontSelectors');
        this.fontFamilySelector = document.getElementById('fontFamilySelector');
        this.fontStyleSelector = document.getElementById('fontStyleSelector');
        this.tabs = document.querySelectorAll('.font-input__tab');
        this.contents = document.querySelectorAll('.font-input__content');
        
        this.initTabs();
        this.initFontUpload();
        this.initLoadLocalFontsButton();
    }

    initTabs() {
        this.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.tabs.forEach(t => t.classList.remove('active'));
                this.contents.forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`${tab.dataset.tab}Content`).classList.add('active');
            });
        });
    }

    initFontUpload() {
        this.fontUpload.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const fontName = file.name.split('.')[0];
                    const fontUrl = e.target.result;
                    this.waterfall.addFont(fontName, fontUrl);
                };
                reader.readAsDataURL(file);
            }
        });
    }

    initLoadLocalFontsButton() {
        if ('queryLocalFonts' in window) {
            this.loadLocalFontsButton.addEventListener('click', () => this.loadLocalFonts());
        } else {
            this.loadLocalFontsButton.textContent = 'Font Access API not supported';
            this.loadLocalFontsButton.disabled = true;
        }
    }

    async loadLocalFonts() {
        try {
            const availableFonts = await window.queryLocalFonts();
            const fontFamilies = new Set();

            availableFonts.forEach(font => {
                fontFamilies.add(font.family);
            });

            this.populateFontFamilySelector(Array.from(fontFamilies).sort(), availableFonts);
            this.fontFamilySelector.addEventListener('change', () => this.updateFontStyleSelector(availableFonts));
            this.fontStyleSelector.addEventListener('change', () => this.updateWaterfallFont());

            this.loadLocalFontsButton.style.display = 'none';
            this.fontSelectors.style.display = 'block';
        } catch (err) {
            console.error('Error querying local fonts:', err);
            this.loadLocalFontsButton.textContent = 'Error loading fonts';
        }
    }

    populateFontFamilySelector(families, availableFonts) {
        this.fontFamilySelector.innerHTML = families.map(family => 
            `<option value="${family}">${family}</option>`
        ).join('');
        this.updateFontStyleSelector(availableFonts);
    }

    updateFontStyleSelector(availableFonts) {
        const selectedFamily = this.fontFamilySelector.value;
        const styles = availableFonts
            .filter(font => font.family === selectedFamily)
            .map(font => font.style);

        this.fontStyleSelector.innerHTML = styles.map(style => 
            `<option value="${style}">${style}</option>`
        ).join('');
        this.updateWaterfallFont();
    }

    updateWaterfallFont() {
        const family = this.fontFamilySelector.value;
        const style = this.fontStyleSelector.value;
        this.waterfall.addLocalFont(family, style);
    }
}

// Initialize the Waterfall instance
const waterfall = new Waterfall();
