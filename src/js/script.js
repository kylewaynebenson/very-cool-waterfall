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
    constructor(name, url, style = null, opentypeFont = null) {
        this.name = name;
        this.url = url;
        this.style = style;
        this.opentypeFont = opentypeFont;
        this.fullFontName = name;
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

            if (this.opentypeFont) {
                // Local font loaded with OpenType.js
                this.loaded = true;
            } else if (this.url) {
                // Load uploaded font
                const font = new FontFace(this.name, `url(${this.url})`);
                await font.load();
                document.fonts.add(font);
                this.loaded = true;
            } else {
                // For local fonts without OpenType.js object, we'll just check if it's available
                await this.checkLocalFont();
            }

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

    compute(wordlist, casing, granularity, selectedFeatures) {
        const lengths = {};
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        ctx.font = `${waterfall.fontSize}px "${this.fullFontName}"`;

        // Apply OpenType features
        if (selectedFeatures.length > 0) {
            ctx.font = `${waterfall.fontSize}px "${this.fullFontName}"`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            const featureSettings = selectedFeatures.map(f => `"${f}" 1`).join(', ');
            ctx.font = ctx.font.replace(/"/g, '');
            ctx.font = `${ctx.font.split(')')[0]}) ${featureSettings}`;
        }

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

    setupFont(ctx, selectedFeatures) {
        if (this.opentypeFont) {
            // Use OpenType.js to apply features
            const path = this.opentypeFont.getPath(text, 0, 0, waterfall.fontSize);
            path.fill = 'black';
            ctx.save();
            ctx.translate(0, waterfall.fontSize);
            path.draw(ctx);
            ctx.restore();
        } else {
            // Fallback to standard canvas text rendering
            ctx.font = `${waterfall.fontSize}px "${this.fullFontName}"`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';

            if (selectedFeatures.length > 0) {
                const featureSettings = selectedFeatures.map(f => `"${f}" 1`).join(', ');
                ctx.font = `${ctx.font.split(')')[0]}) ${featureSettings}`;
            }
        }
    }

    measureTextWidth(ctx, text) {
        if (this.opentypeFont) {
            // Use OpenType.js to measure text
            const path = this.opentypeFont.getPath(text, 0, 0, waterfall.fontSize);
            const bbox = path.getBoundingBox();
            return Math.ceil(bbox.x2 - bbox.x1);
        } else {
            // Fallback to standard canvas text measurement
            const metrics = ctx.measureText(text);
            return Math.ceil(metrics.width);
        }
    }
}

class Waterfall {
    constructor() {
        this.done = false;
        this.fontSize = 80;
        this.lineHeight = 1;
        this.casing = 'ic';
        this.granularity = 5;
        this.resultsCount = 10;
        this._runlength = 500;
        this.seed = 1;
        this.shiftMode = false;
        this.targetWord = '';
        this.currentWordList = 'default';
        this.isShuffled = false;
        this.filterLetters = [];
        this.features = new Set();
        this.featureDescriptions = new Map();

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
    }

    init() {
        this.loadDict();
        this.setupEventListeners();
    }

    setupEventListeners() {
        console.log('Setting up event listeners');
        document.addEventListener("keydown", event => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.keyCode === 16) this.shiftMode = true;
        });

        document.addEventListener("keyup", event => {
            if (event.keyCode === 16) this.shiftMode = false;
        });

        const runlengthSlider = document.getElementById('runlength');
        const runlengthDisplay = document.getElementById('runlengthDisplay');
        
        if (runlengthSlider && runlengthDisplay) {
            let debounceTimer;

            // Update display when slider moves (without immediate computation)
            runlengthSlider.addEventListener('input', (e) => {
                runlengthDisplay.value = e.target.value;
                this._runlength = parseInt(e.target.value);
            });

            // Compute only when slider stops
            runlengthSlider.addEventListener('change', (e) => {
                this.computeIfReady();
            });

            // Update slider when display input changes (debounced)
            runlengthDisplay.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                let value = parseInt(e.target.value);
                value = Math.min(Math.max(value, 10), 1200);
                runlengthSlider.value = value;
                this._runlength = value;
                
                debounceTimer = setTimeout(() => {
                    this.computeIfReady();
                }, 300); // Wait 300ms after last input before computing
            });

            // Clean up invalid input when focus is lost
            runlengthDisplay.addEventListener('blur', (e) => {
                let value = parseInt(e.target.value);
                if (isNaN(value)) value = 500;
                value = Math.min(Math.max(value, 10), 1200);
                e.target.value = value;
                runlengthSlider.value = value;
                this._runlength = value;
                this.computeIfReady();
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

        const lettersInput = document.getElementById('letters');
        if (lettersInput) {
            lettersInput.addEventListener('input', (e) => {
                this.filterLetters = e.target.value.split(',').map(letter => letter.trim().toLowerCase());
                this.computeIfReady();
            });
        }

        const loadLocalFontsButton = document.getElementById('loadLocalFonts');
        if (loadLocalFontsButton) {
            loadLocalFontsButton.addEventListener('click', async () => {
                const fonts = await window.queryLocalFonts();
                // Handle local fonts selection...
                // When a font is selected, you can use it like this:
                // const fontData = await selectedFont.blob();
                // const font = await opentype.load(fontData);
                // this.updateFeatures(font);
            });
        }

        const fontUpload = document.getElementById('fontUpload');
        if (fontUpload) {
            fontUpload.addEventListener('change', (e) => {
                console.log('Font file selected');
                const file = e.target.files[0];
                if (file) {
                    this.loadFont(file);
                }
            });
        } else {
            console.error('Font upload input not found');
        }

        const wordListSelect = document.getElementById('wordList');
        if (wordListSelect) {
            wordListSelect.addEventListener('change', (e) => {
                this.currentWordList = e.target.value;
                this.loadDict();
            });
        }

        const randomizeBtn = document.getElementById('randomize');
        if (randomizeBtn) {
            randomizeBtn.addEventListener('click', () => {
                console.log('Randomize clicked');
                this.isShuffled = true;
                this.computeIfReady();
            });
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
                // Handle manually uploaded dictionary file
                this.dict.manual = true;
                if (!source.name.endsWith('.txt')) {
                    throw new Error("Dictionary file must be .txt. (Reverting to default.)");
                }
                text = await source.text();
            } else {
                // Load from predefined word lists
                this.dict.manual = false;
                const wordListPaths = {
                    'default': 'dist/words.txt',
                    'cyrillic': 'dist/words-cyrillic.txt',
                    'greek': 'dist/words-greek.txt',
                    'latin-extended': 'dist/words-latin-extended.txt'
                };

                const path = wordListPaths[this.currentWordList];
                if (!path) {
                    throw new Error(`Invalid word list: ${this.currentWordList}`);
                }

                const response = await fetch(path);
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
        const selectedFeatures = this.getSelectedFeatures();
        for (const font of this.fonts) {
            const filteredDict = this.filterDictionary(this.dict.dict);
            
            // If shuffled is requested, shuffle the filtered dictionary
            if (this.isShuffled) {
                for (let i = filteredDict.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [filteredDict[i], filteredDict[j]] = [filteredDict[j], filteredDict[i]];
                }
            }
            
            font.compute(filteredDict, this.casing, this.granularity, selectedFeatures);
        }
        this.done = true;
        this.updateUI();
    }

    getSelectedFeatures() {
        const selectedFeatures = [];
        this.features.forEach(feature => {
            const checkbox = document.getElementById(feature);
            if (checkbox && checkbox.checked) {
                selectedFeatures.push(feature);
            }
        });
        console.log('Selected features:', selectedFeatures);
        return selectedFeatures;
    }

    filterDictionary(wordlist) {
        if (!wordlist) return [];
        if (this.filterLetters.length === 0) {
            return wordlist;
        }
        return wordlist.filter(word => 
            this.filterLetters.every(letter => word.toLowerCase().includes(letter))
        );
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
            
            const selectedFeatures = this.getSelectedFeatures();
            
            for (const font of this.fonts) {
                if (font.computed) {
                    this.currentFont = font;
                    const results = font.computed[this.quantizedRunlength] || [];
                    this.currentResultsCount = results.length;
                    
                    const fontElement = document.createElement('div');
                    fontElement.style.fontFamily = `"${font.fullFontName}"`;
                    fontElement.style.fontSize = `${this.fontSize}px`;
                    fontElement.style.lineHeight = this.lineHeight;
                    
                    if (selectedFeatures.length > 0) {
                        const featureSettings = selectedFeatures.map(f => `"${f}" 1`).join(', ');
                        fontElement.style.fontFeatureSettings = featureSettings;
                    }
                    
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

    addLocalFont(postScriptName, opentypeFont, style) {
        const newFont = new WFont(postScriptName, null, style, opentypeFont);
        this.fonts = [newFont]; // Replace existing fonts with the new local font
        
        // Enable all controls by removing 'disabled' class
        document.querySelectorAll('.disabled').forEach(element => {
            element.classList.remove('disabled');
        });
        
        this.updateFeatures(opentypeFont);
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

    async loadFont(file) {
        console.log('Loading font:', file.name);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const font = await opentype.parse(arrayBuffer);
            console.log('Font loaded successfully:', font.names.fullName);
            
            // Update font upload button text
            const fontUpload = document.getElementById('fontUpload');
            const fontLabel = fontUpload?.nextElementSibling;
            if (fontLabel) {
                fontLabel.textContent = file.name;
            }

            // Clear any existing fonts
            this.fonts = [];
            
            // Enable all controls by removing 'disabled' class
            document.querySelectorAll('.disabled').forEach(element => {
                element.classList.remove('disabled');
            });
            
            // Hide local font selectors if they're visible
            const fontSelectors = document.getElementById('fontSelectors');
            if (fontSelectors) {
                fontSelectors.style.display = 'none';
            }
            
            // Show the local fonts button again
            const loadLocalFontsButton = document.getElementById('loadLocalFonts');
            if (loadLocalFontsButton) {
                loadLocalFontsButton.style.display = 'block';
            }
            
            this.updateFeatures(font);
            
            // Select 'default' in word list dropdown and trigger update
            const wordListSelect = document.getElementById('wordList');
            if (wordListSelect) {
                wordListSelect.value = 'default';
                this.currentWordList = 'default';
                const event = new Event('change');
                wordListSelect.dispatchEvent(event);
                await this.loadDict();
                this.computeIfReady();
            }
        } catch (error) {
            console.error('Error loading font:', error);
        }
    }

    updateFeatures(font) {
        console.log('Updating features for font:', font.names.fullName);
        this.features.clear();
        this.featureDescriptions.clear();
        const gsub = font.tables.gsub;
        if (gsub) {
            console.log('GSUB table found');
            gsub.features.forEach(feature => {
                console.log('Checking feature:', feature.tag);
                if (feature.tag.startsWith('ss') || feature.tag === 'liga') {
                    this.features.add(feature.tag);
                    // Store the feature name if available
                    if (feature.name) {
                        this.featureDescriptions.set(feature.tag, feature.name);
                    }
                    console.log('Added feature:', feature.tag, feature.name);
                }
            });
        } else {
            console.log('No GSUB table found in the font');
        }
        console.log('Final features set:', Array.from(this.features));
        console.log('Feature descriptions:', this.featureDescriptions);
        this.generateFeatureCheckboxes();
    }

    generateFeatureCheckboxes() {
        console.log('Generating feature checkboxes');
        const featuresDiv = document.getElementById('features');
        if (!featuresDiv) {
            console.error('Features div not found');
            return;
        }
        featuresDiv.innerHTML = ''; // Clear existing checkboxes

        if (this.features.size === 0) {
            console.log('No features to generate checkboxes for');
            featuresDiv.textContent = 'No OpenType features detected';
            return;
        }

        this.features.forEach(feature => {
            console.log('Creating checkbox for feature:', feature);
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = feature;
            checkbox.name = feature;
            checkbox.value = 'true';
            checkbox.className = 'input-checkbox';

            const label = document.createElement('label');
            label.htmlFor = feature;
            label.textContent = feature.toUpperCase();
            label.className = 't__xxs';

            // Add title attribute with feature description if available
            const description = this.featureDescriptions.get(feature);
            if (description) {
                label.title = description;
            }

            featuresDiv.appendChild(checkbox);
            featuresDiv.appendChild(label);

            checkbox.addEventListener('change', () => {
                console.log('Feature checkbox changed:', feature, checkbox.checked);
                this.computeIfReady();
            });
        });
        console.log('Feature checkboxes generated');
    }

    // Add shuffle method
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
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
            this.fontStyleSelector.addEventListener('change', () => this.updateWaterfallFont(availableFonts));

            this.loadLocalFontsButton.style.display = 'none';
            this.fontSelectors.style.display = 'block';
            
            // Enable controls when font selectors are shown
            document.querySelectorAll('.disabled').forEach(element => {
                element.classList.remove('disabled');
            });
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
        this.updateWaterfallFont(availableFonts);
    }

    async updateWaterfallFont(availableFonts) {
        const family = this.fontFamilySelector.value;
        const style = this.fontStyleSelector.value;
        const selectedFont = availableFonts.find(f => f.family === family && f.style === style);
        
        if (selectedFont) {
            try {
                const fontData = await selectedFont.blob();
                const arrayBuffer = await fontData.arrayBuffer();
                const font = opentype.parse(arrayBuffer);
                
                const postScriptName = font.names.postScriptName?.en || font.names.fullName?.en || `${family}-${style}`;
                console.log('Loading font:', postScriptName);
                
                // Enable all controls by removing 'disabled' class
                document.querySelectorAll('.disabled').forEach(element => {
                    element.classList.remove('disabled');
                });
                
                this.waterfall.addLocalFont(postScriptName, font, style);
            } catch (error) {
                console.error('Error loading font with OpenType.js:', error);
            }
        }
    }
}
// Initialize the Waterfall instance
const waterfall = new Waterfall();
console.log('Waterfall instance created and event listeners set up');

