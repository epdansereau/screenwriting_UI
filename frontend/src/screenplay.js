/* screenplay.js ----------------------------------------------------------- *
 * A faithful ES‑module port of the original Python/Pydantic implementation *
 * Author: Étienne Piérard Dansereau (ported by ChatGPT, 2025‑05‑04)        *
 * ------------------------------------------------------------------------ */

/* -------- Node‑compat helpers (xmldom lacks querySelector + iterator) -- */
function _first(el, tagName) {
    const list = el.childNodes || [];
    for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (n.nodeType === 1 && n.tagName === tagName) return n;
    }
    return null;
}
function _hasChild(el, tagName) {
    return !!_first(el, tagName);
}

export class TextElement {
    constructor(text, style = null) {
        this.text = text;
        this.style = style;          // e.g. 'Bold', 'Italic+Underline', …
    }

    /** Return the element as plain text or markdown. */
    format(markdown = true) {
        if (!markdown || !this.style) return this.text;

        const s = this.text;
        const map = {
            'Bold+Italic+Underline+Strikeout': `***~~__${s}__~~***`,
            'Bold+Italic+Underline': `***__${s}__***`,
            'Bold+Italic+Strikeout': `***~~${s}~~***`,
            'Bold+Underline+Strikeout': `**~~__${s}__~~**`,
            'Italic+Underline+Strikeout': `*~~__${s}__~~*`,
            'Bold+Italic': `***${s}***`,
            'Bold+Underline': `**__${s}__**`,
            'Bold+Strikeout': `**~~${s}~~**`,
            'Italic+Underline': `*__${s}__*`,
            'Italic+Strikeout': `*~~${s}~~*`,
            'Underline+Strikeout': `__~~${s}~~__`,
            'Bold': `**${s}**`,
            'Italic': `*${s}*`,
            'Underline': `__${s}__`,
            'Strikeout': `~~${s}~~`,
        };
        return map[this.style] ?? this.text;
    }
}

/* ----------------------------------------------------------------------- */
export class Paragraph {
    constructor(type, textElements) {
        this.type = type;                 // 'Scene Heading', 'Dialogue', etc.
        this.text_elements = textElements; // Array<TextElement>, snake case for compatibility with the python version
    }

    /** Return the paragraph as screenplay‑formatted text. */
    format(spacing = true, markdown = true) {
        const txt = this.text_elements.map(e => e.format(markdown)).join('');
        switch (this.type) {
            case 'Scene Heading': return txt.toUpperCase();
            case 'Character': return `${spacing ? ' '.repeat(21) : ''}${txt.toUpperCase()}`;
            case 'Parenthetical': return `${spacing ? ' '.repeat(15) : ''}${txt}`;
            case 'Transition': {
                const indent = spacing ? ' '.repeat(Math.max(0, 55 - txt.length)) : '';
                return `${indent}${txt.toUpperCase()}`;
            }
            case 'Dialogue': return `${spacing ? ' '.repeat(10) : ''}${txt}`;
            default: return txt;
        }
    }

    /** Convert to an XML Element for FDX output. */
    fdxElement(doc) {
        const paraEl = doc.createElement('Paragraph');
        paraEl.setAttribute('Type', this.type);
        this.text_elements.forEach(te => {
            const teEl = doc.createElement('Text');
            teEl.textContent = te.text;
            if (te.style) teEl.setAttribute('Style', te.style);
            paraEl.appendChild(teEl);
        });
        return paraEl;
    }
}

/* ----------------------------------------------------------------------- */
export class DualDialogue {
    constructor(paragraphs) {
        this.paragraphs = paragraphs;   // [Char, Dial, Char, Dial]
    }

    format(spacing = true, markdown = true) {
        let secondChar = false;
        const out = [];

        this.paragraphs.forEach(p => {
            let copy = p;
            if (p.type === 'Character' && secondChar && markdown) {
                const first = p.text_elements[0];
                const newFirst = new TextElement(`^${first.text}`, first.style);
                copy = new Paragraph(p.type, [newFirst, ...p.text_elements.slice(1)]);
            }
            out.push(copy.format(spacing, markdown));
            if (p.type === 'Character') secondChar = true;
        });

        return out.join('\n');
    }

    fdxElement(doc) {
        const para = doc.createElement('Paragraph');
        const dd = doc.createElement('DualDialogue');
        this.paragraphs.forEach(p => dd.appendChild(p.fdxElement(doc)));
        para.appendChild(dd);
        return para;
    }
}

/* ----------------------------------------------------------------------- */
export class Scene {
    constructor(paragraphs = []) {
        this.paragraphs = paragraphs; // Array<Paragraph | DualDialogue>
    }

    write(spacing = true, markdown = false) {
        const lines = [];
        let prev = null;

        for (const el of this.paragraphs) {
            const fmt = el.format(spacing, markdown);
            const cur = el instanceof DualDialogue ? 'DualDialogue' : el.type;

            if (
                spacing && prev &&
                !(['Character', 'Parenthetical', 'Dialogue'].includes(prev) &&
                    ['Parenthetical', 'Dialogue'].includes(cur))
            ) lines.push('');

            lines.push(fmt);
            prev = cur;
        }
        return lines.join('\n');
    }

    addParagraph(p) { this.paragraphs.push(p); }
    addDualDialogue(dd) { this.paragraphs.push(dd); }
}

/* ----------------------------------------------------------------------- */
export class Screenplay {
    constructor() {
        this.scenes = [];  // Array<Scene>
        this.metadata = [];  // Array<Element>
    }

    /* -------- basic utils -------- */
    addScene(sc) { this.scenes.push(sc); }
    setMetadata(meta) { this.metadata = meta; }

    /* -------- stringify helpers -------- */
    writeScreenplay(spacing = true, markdown = false) {
        return this.scenes.map(s => s.write(spacing, markdown)).join('\n');
    }
    write(spacing = false, markdown = false) { return this.writeScreenplay(spacing, markdown); }

    /* -------- FDX (XML) generation -------- */
    _toFdxXml() {
        const doc = document.implementation.createDocument('', '', null);
        const root = doc.createElement('FinalDraft');
        root.setAttribute('DocumentType', 'Script');
        root.setAttribute('Template', 'No');
        root.setAttribute('Version', '5');
        const content = doc.createElement('Content');

        this.scenes.forEach(scene =>
            scene.paragraphs.forEach(p => content.appendChild(p.fdxElement(doc)))
        );
        root.appendChild(content);
        this.metadata.forEach(m => root.appendChild(m.cloneNode(true)));
        doc.appendChild(root);
        return new XMLSerializer().serializeToString(doc);
    }

    toFdx() { return this._toFdxXml(); }
    toText(spacing = true, markdown = true) { return this.writeScreenplay(spacing, markdown); }
    /** Return JSON that matches Python save_as_json (scenes only). */
    toJson() {
        const serText = te => ({ text: te.text, style: te.style ?? null });
        const serPara = para => ({
            type: para.type,
            text_elements: (para.text_elements || []).map(serText),
        });
        const serDual = dd => ({
            dual_dialogue: dd.paragraphs.map(serPara),
        });
        const serScene = sc => ({
            paragraphs: sc.paragraphs.map(p =>
                p instanceof DualDialogue ? serDual(p) : serPara(p)
            ),
        });

        return JSON.stringify({ scenes: this.scenes.map(serScene) }, null, 2);
    }

    /* -------- Save helpers (browser‑friendly) -------- */
    /** trigger a download; type can be 'application/json', 'text/xml', ... */
    static download(data, filename, mime = 'text/plain') {
        const blob = new Blob([data], { type: mime });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob), download: filename
        });
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(a.href);
    }

    /* ********************************************************************** *
     * ---------------  STATIC BUILDERS (parsers) --------------------------- *
     * ********************************************************************** */

    /* ---- JSON ---- */
    static fromJson(jsonText) {
        const raw = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
        const sp = new Screenplay();
        raw.scenes?.forEach(s => sp.addScene(Screenplay.#_deserializeScene(s)));
        return sp;
    }

    /* ---- FDX ---- */
    static fromFdx(fdxText) {
        const dom = new DOMParser().parseFromString(fdxText, 'application/xml');
        const sp = new Screenplay();
        const cnt = dom.querySelector ? dom.querySelector('Content')
            : dom.getElementsByTagName('Content')[0];
        let cur = new Scene();

        const extractTextElements = el => {
            const out = [];
            let buf = '', last = null;

            const textNodes = el.querySelectorAll
                ? Array.from(el.querySelectorAll('Text'))
                : Array.from(el.getElementsByTagName('Text'));
            textNodes.forEach(te => {
                const txt = te.textContent ?? '';
                const style = te.getAttribute('Style') || null;
                if (style !== last && buf) {
                    out.push(new TextElement(buf, last)); buf = '';
                }
                buf += txt; last = style;
            });
            if (buf) out.push(new TextElement(buf, last));
            return out;
        };

        Array.from(cnt?.childNodes || []).forEach(node => {
            if (node.nodeType !== 1 /*ELEMENT_NODE*/ || node.tagName !== 'Paragraph') return;

            const type = node.getAttribute('Type');
            const dual = node.querySelector
                ? node.querySelector(':scope > DualDialogue')
                : _first(node, 'DualDialogue');

            if (type === 'Scene Heading') {
                if (cur.paragraphs.length) sp.addScene(cur);
                cur = new Scene([new Paragraph('Scene Heading', extractTextElements(node))]);
            } else if (dual) {
                const paras = [];
                Array.from(dual.childNodes || []).forEach(sub => {
                    if (sub.nodeType === 1)
                        paras.push(new Paragraph(sub.getAttribute('Type'), extractTextElements(sub)));
                });
                cur.addDualDialogue(new DualDialogue(paras));
            } else {
                cur.addParagraph(new Paragraph(type, extractTextElements(node)));
            }
        });

        if (cur.paragraphs.length) sp.addScene(cur);

        /* metadata = everything after <Content/> */
        const all = Array.from(dom.documentElement.childNodes);
        const idx = all.indexOf(cnt);
        sp.setMetadata(all.slice(idx + 1));

        return sp;
    }

    /* ---- Plain Text (with or without Markdown / Fountain) ---- */
    static fromPlain(text, { markdown = true, allowFountain = true,
        cleanSpacing = true, cleanPaging = true } = {}) {
        const lines = text.split(/\r?\n/);
        return Screenplay.#_fromLines(lines, markdown, allowFountain, cleanSpacing, cleanPaging);
    }

    /* ------------------ INTERNAL HELPERS ------------------ */
    static #_deserializeScene(obj) {
        const paras = obj.paragraphs.map(p =>
            p.dual_dialogue
                ? new DualDialogue(p.dual_dialogue.map(Screenplay.#_deserializeParagraph))
                : Screenplay.#_deserializeParagraph(p)
        );
        return new Scene(paras);
    }
    static #_deserializeParagraph(p) {
        const te = p.text_elements.map(te => new TextElement(te.text, te.style));
        return new Paragraph(p.type, te);
    }

    /* ---- full plain‑text parser (cleaning, Markdown, dual dialogue) ---- */
    static #_fromLines(lines, markdown, allowFountain, cleanSpacing, cleanPaging) {
        const screenplay = new Screenplay();
        let current = [];      // Paragraph[]
        let prevType = null;

        /* spacing cleanup (merge wrapped lines) */
        const cleanSpacingFn = rows => {
            const out = [], prevIndent = [];
            rows.forEach(line => {
                const stripped = line.replace(/^\s+/, '');
                const indent = line.slice(0, line.length - stripped.length);
                if (!stripped) { out.push(''); prevIndent[0] = null; return; }

                if (out.length &&
                    prevIndent[0] != null &&
                    (indent === prevIndent[0] || indent === prevIndent[0] + ' ')) {
                    out[out.length - 1] = out[out.length - 1].replace(/\s+$/, '') + ' ' + stripped;
                } else {
                    out.push(indent ? line : stripped);
                    prevIndent[0] = indent;
                }
            });
            return out;
        };

        /* page‑number cleanup */
        const cleanPagingFn = rows =>
            rows.filter(l => !/^\s*(?:p\.|PAGE|page)?\s*\d{1,3}\s*$/i.test(l.trim()));

        if (cleanSpacing) lines = cleanSpacingFn(lines);
        if (cleanPaging) lines = cleanPagingFn(lines);

        /* Markdown → TextElement[] */
        const parseMarkdown = (txt, md = true) => {
            if (!md) return [new TextElement(txt)];
            const rules = [
                [/\*\*\*~~__([^_~*]+?)__~~\*\*\*/, 'Bold+Italic+Underline+Strikeout'],
                [/\*\*\*__([^_]+?)__\*\*\*/, 'Bold+Italic+Underline'],
                [/\*\*\*~~([^~]+?)~~\*\*\*/, 'Bold+Italic+Strikeout'],
                [/\*\*~~__([^_~*]+?)__~~\*\*/, 'Bold+Underline+Strikeout'],
                [/\*~~__([^_~*]+?)__~~\*/, 'Italic+Underline+Strikeout'],
                [/\*\*\*([^*]+?)\*\*\*/, 'Bold+Italic'],
                [/\*\*__([^_]+?)__\*\*/, 'Bold+Underline'],
                [/\*\*~~([^~]+?)~~\*\*/, 'Bold+Strikeout'],
                [/\*__([^_]+?)__\*/, 'Italic+Underline'],
                [/\*~~([^~]+?)~~\*/, 'Italic+Strikeout'],
                [/__~~([^~]+?)~~__/, 'Underline+Strikeout'],
                [/\*\*([^*]+?)\*\*/, 'Bold'],
                [/\*([^*]+?)\*/, 'Italic'],
                [/__([^_]+?)__/, 'Underline'],
                [/~~([^~]+?)~~/, 'Strikeout'],
            ];
            const out = []; let rest = txt;
            while (rest) {
                let matched = false;
                for (const [re, style] of rules) {
                    re.lastIndex = 0;
                    const m = re.exec(rest);
                    if (m) {
                        if (m.index) out.push(new TextElement(rest.slice(0, m.index)));
                        out.push(new TextElement(m[1], style));
                        rest = rest.slice(m.index + m[0].length);
                        matched = true; break;
                    }
                }
                if (!matched) { out.push(new TextElement(rest)); break; }
            }
            return out;
        };

        /* dual‑dialogue grouping (^ second character) */
        const toDualDialogues = paras => {
            const out = [];
            for (let i = 0; i < paras.length;) {
                if (
                    paras[i].type === 'Character' &&
                    i + 3 < paras.length &&
                    paras[i + 2].type === 'Character' &&
                    paras[i + 2].text_elements[0]?.text.startsWith('^')
                ) {
                    const cleanedFirst = paras[i + 2].text_elements[0];
                    const newFirst = new TextElement(cleanedFirst.text.slice(1), cleanedFirst.style);
                    const newChar = new Paragraph('Character', [newFirst, ...paras[i + 2].text_elements.slice(1)]);
                    out.push(new DualDialogue([paras[i], paras[i + 1], newChar, paras[i + 3]]));
                    i += 4;
                } else {
                    out.push(paras[i]); i += 1;
                }
            }
            return out;
        };

        /* character‑normalisation: stray CHARACTER lines → ACTION */
        const normaliseChars = paras => {
            for (let i = 0; i < paras.length; i++) {
                if (paras[i].type === 'Character' &&
                    (i === paras.length - 1 ||
                        !['Dialogue', 'Parenthetical'].includes(paras[i + 1].type)))
                    paras[i].type = 'Action';
            }
        };

        /* -------- parse line‑by‑line -------- */
        for (const lineRaw of lines) {
            const line0 = lineRaw.trim();
            if (!line0) continue;

            const noNum = line0.replace(/^\s*\d+[A-Z]?[.\s-]+/, '');

            /* Scene Heading (INT./EXT. or . FOUNTAIN) */
            if (/^(INT|EXT|INTERIOR|EXTERIOR|I\.\/E|I\/E)[\s./:-]/i.test(noNum) ||
                (/^\.(?!\.)/.test(line0) && allowFountain)) {
                if (current.length) {
                    normaliseChars(current);
                    screenplay.addScene(new Scene(toDualDialogues(current)));
                }
                current = [new Paragraph('Scene Heading', parseMarkdown(noNum, markdown))];
                prevType = 'Scene Heading';
                continue;
            }

            /* Fountain shorthands */
            if (allowFountain) {
                if (line0.startsWith('@')) {
                    current.push(new Paragraph('Character', parseMarkdown(line0.slice(1), markdown)));
                    prevType = 'Character'; continue;
                }
                if (line0.startsWith('!')) {
                    current.push(new Paragraph('Action', parseMarkdown(line0.slice(1), markdown)));
                    prevType = 'Action'; continue;
                }
                if (line0.startsWith('>')) {
                    current.push(new Paragraph('Transition', parseMarkdown(line0.slice(1), markdown)));
                    prevType = 'Transition'; continue;
                }
            }

            /* Parenthetical line */
            if (line0.startsWith('(') && line0.endsWith(')')) {
                current.push(new Paragraph('Parenthetical', parseMarkdown(line0, markdown)));
                prevType = 'Parenthetical'; continue;
            }

            /* UPPERCASE: Transition or Character */
            if (/^[A-Z0-9 .\-'()]+:$/.test(line0)) {
                current.push(new Paragraph('Transition', parseMarkdown(line0, markdown)));
                prevType = 'Transition'; continue;
            }
            if (line0 === line0.toUpperCase() && /[A-ZÀ-Ý]/.test(line0)) {
                current.push(new Paragraph('Character', parseMarkdown(line0, markdown)));
                prevType = 'Character'; continue;
            }

            /* Dialogue following Character/Parenthetical */
            if (['Character', 'Parenthetical'].includes(prevType) &&
                !(line0.startsWith('^') && allowFountain)) {
                current.push(new Paragraph('Dialogue', parseMarkdown(line0, markdown)));
                prevType = 'Dialogue'; continue;
            }

            /* Default: Action */
            current.push(new Paragraph('Action', parseMarkdown(line0, markdown)));
            prevType = 'Action';
        }

        if (current.length) {
            normaliseChars(current);
            screenplay.addScene(new Scene(toDualDialogues(current)));
        }

        return screenplay;
    }
}

/* EOF -------------------------------------------------------------------- */
