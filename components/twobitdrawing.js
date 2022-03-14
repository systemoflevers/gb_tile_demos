import { TwoBitCanvas } from './twobitcanvas.js';
//import { TwoBitColourPicker } from './twobitcolourpicker.js';
import { arrayBufferToBase64, base64ToUint8Array, TileMap } from '../modules/data_conversion.js';

const template = document.createElement('template');
template.innerHTML = `
<style>
:host {
  display: block;
  position: relative;
}
two-bit-canvas {
    cursor: crosshair;
    width: 100%;
    touch-action: pinch-zoom;
}
#tool-picker {
    position: absolute;
    left: 100%;
    top: 12%;
}
#colour-picker {
    position: absolute;
    //margin-top: 5px;
    width: 63%;
}

#colour-picker input {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
}

#colour-picker input:checked ~ label>div {
    /*border-color: white;*/
    /* border-style: solid; */
    border-width: 4px;
    padding-bottom: 0%;
    /* border-color: white; */
    margin-bottom: 3%;
    
}
/*#colour-picker {
    display: none;
}*/
#colour-picker div {
    //width: calc(0.1 * var(--base-width));
    width: 10%;
    aspect-ratio: 1;
    display: inline-block;
    //padding: 3px;
    //box-sizing: border-box;
}
#swatch-0 {
    background-color: rgb(224, 248, 208);
    border-color: rgb(52, 104, 86);
}
#swatch-1 {
    background-color: rgb(136, 192, 112);
    border-color: rgb(8, 24, 32);
}
#swatch-2 {
    background-color: rgb(52, 104, 86);
    border-color: rgb(224, 248, 208);
}
#swatch-3{
    background-color: rgb(8, 24, 32);
    border-color: rgb(136, 192, 112);
}
two-bit-colour-picker {
    position: absolute;
    width: 25%;
}
</style>
<div>
<two-bit-canvas></two-bit-canvas>
<!--two-bit-colour-picker></two-bit-colour-picker-->
<div id="colour-picker">
<span><input type="radio" name="colour" id="c0" value="0" />
<label for="c0"><div id="swatch-0"></div></label></span>
<span><input type="radio" name="colour" id="c1" value="1" /><label for="c1"><div id="swatch-1"></div></label></span>
<span><input type="radio" name="colour" id="c2" value="2" /><label for="c2"><div id="swatch-2"></div></label></span>
<span><input type="radio" name="colour" id="c3" value="3" checked /><label for="c3"><div id="swatch-3"></div></label></span>
</div>
<div id="tool-picker">
<span><input type="radio" name="tool" id="pencil" value="0" checked />
<label for="pencil">pencil</label></span>
<span><input type="radio" name="tool" id="tile-select" value="1" />
<label for="tile-select">tile-select</label></span>
<span><input type="radio" name="tool" id="tile-place" value="2" />
<label for="tile-place">place tile</label></span>
</div>
</div>
`;

function convertCoordinate(point, origin, boundingLength, pixelLength) {
    const v = Math.floor(((point - origin) / boundingLength) * pixelLength);
    return v;
}

const PENCIL = 0;
const TILE_SELECT = 1;
const TILE_PLACE = 2;

class TwoBitDrawing extends HTMLElement {
    constructor() {
        super();

        const shadow = this.attachShadow({ mode: 'open' });
        shadow.appendChild(template.content.cloneNode(true));
        this.twoBitCanvas = shadow.querySelector('two-bit-canvas');
        this.isPointerDown = false;
        this.colour = 3;

        const colourPickerDiv = shadow.getElementById('colour-picker');
        colourPickerDiv.addEventListener('change', (event) => {
            this.colour = parseInt(event.target.value);
        });
        const toolPickerDiv = shadow.getElementById('tool-picker');
        toolPickerDiv.addEventListener('change', (ev) => {
            this.tool = parseInt(ev.target.value);
        });
        this.lastPoint = null;
        this.needRedraw = false;
        this.changedTiles = new Set();

        this.tool = PENCIL;

        this.selectedTile = 0;
        this.nextTile = 1;
    }

    static get observedAttributes() { return ['width', 'height']; }
    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;
        console.log('change', name, oldValue, newValue, this[name]);
        this.updateDimensions();
    }

    get height() {
        return parseInt(this.getAttribute('height')) || 0;
    }
    set height(value) {
        console.log('height setter');
        this.setAttribute('height', value);
    }

    get width() {
        return parseInt(this.getAttribute('width')) || 0;
    }
    set width(value) {
        this.setAttribute('width', value);
    }

    updateDimensions() {
        if (this.width === 0) return;
        if (this.height === 0) return;
        if (this.width % 8 !== 0) {
            this.width = 8 * Math.ceil(this.width / 8);
            // I think this should cause an attributeChanged event.
            return;
        }
        if (this.height % 8 !== 0) {
            this.height = 8 * Math.ceil(this.height / 8);
            return;
        }
        this.twoBitCanvas.width = this.width;
        this.twoBitCanvas.height = this.height

        this.tileMap = TileMap.makeSimpleMap(this.width / 8, this.height / 8);
    }

    setPixel(x, y, v) {
        if (x >= this.width || x < 0 || y >= this.height || y < 0) {
            return -1;
        }
        return this.tileMap.setPixel(x, y, v);
        return this.twoBitCanvas.setPixel(x, y, v);
    }

    drawLine(start, end) {
        this.changedTiles.add(this.setPixel(start.x, start.y, this.colour));
        if (start.x === end.x) {
            const [minY, maxY] = start.y < end.y ? [start.y, end.y] : [end.y, start.y];
            for (let y = minY; y <= maxY; y++) {
                this.changedTiles.add(this.setPixel(start.x, y, this.colour));
            }
            return;
        }
        const slope = (end.y - start.y) / (end.x - start.x);
        const xSign = Math.sign(end.x - start.x);
        let prev = start;
        for (let i = 1; i <= Math.abs(end.x - start.x); i++) {
            const x = start.x + (xSign * i);
            const y = Math.round(start.y + (xSign * i * slope));
            const ySign = Math.sign(y - prev.y);
            for (let j = 0; j < Math.abs(y - prev.y); j++) {
                const altX = Math.round(prev.x + (ySign * j / slope));
                this.changedTiles.add(this.setPixel(altX, prev.y + (ySign * j), this.colour));
            }
            prev = { x, y };
            this.changedTiles.add(this.setPixel(x, y, this.colour));
        }
    }

    connectedCallback() {
        this.twoBitCanvas.onpointerdown = this.pointerDownHandler.bind(this);
        this.twoBitCanvas.onpointerup = this.pointerUpHandler.bind(this);

        this.updateDimensions();
        const draw = () => {
            if (this.needRedraw) {
                this.twoBitCanvas.setTwoBitData(this.tileMap.toPixelArray());
                this.needRedraw = false;
                this.dispatchEvent(new CustomEvent('needRedraw', {detail: this.changedTiles}));
                this.changedTiles = new Set();
            }
            requestAnimationFrame(draw);
        };
        draw();
        if (this.selectedTile !== null) {
            //const tileIndex = this.tileMap.tileMap.tileMap[this.selectedTile];

            // doesn't seem to work, maybe when this happens nothing's there to
            // receive the event yet?
            this.dispatchEvent(new CustomEvent('tileSelected', { detail: this.selectedTile }));
        }
    }

    pointerDownHandler(ev) {
        if (ev.button !== 0) return;

        const { x, y } = this.getMousePos(ev);
        if (this.tool === PENCIL) {
            this.needRedraw = true;
            const tileIndex = this.setPixel(x, y, this.colour);
            this.changedTiles.add(tileIndex);
            this.lastPoint = { x, y };
            this.twoBitCanvas.onpointermove = this.pointerMoveHandler.bind(this);
            this.twoBitCanvas.setPointerCapture(ev.pointerId);
        } else if(this.tool === TILE_SELECT) {
            // Use toTileXY to get the index of the tile that's displayed.
            //const {tileIndex} = this.tileMap.toTileXY(x, y);
            const tileMapIndex = this.tileMap.toMapIndex(x, y);
            // I don't remember why this indirection is needed...
            // I think I could just store tileIndex instead.
            this.selectedTile = tileMapIndex;
            const tileIndex = this.tileMap.tileMap[tileMapIndex];
            this.selectedTile = tileIndex;
            this.dispatchEvent(new CustomEvent('tileSelected', { detail: tileIndex }));
            return;
        } else if(this.tool === TILE_PLACE) {
            // Use toMapIndex to get the map index for the clicked point. This
            // is so we can change what's being displayed there.
            const tileIndex = this.tileMap.toMapIndex(x, y);
            this.needRedraw = true;
            this.tileMap.tileMap[tileIndex] = this.selectedTile;//this.tileMap.tileMap[this.selectedTile];
            return;
        }
    }

    pointerUpHandler(ev) {
        if (ev.button !== 0) return;
        if (this.lastPoint === null) return;
        this.needRedraw = true;
        const { x, y } = this.getMousePos(ev);

        this.drawLine(this.lastPoint, { x, y });
        this.lastPoint = null;
        this.twoBitCanvas.onpointermove = null;
    }

    pointerMoveHandler(event) {
        this.needRedraw = true;
        if (event.getCoalescedEvents) {
            const events = event.getCoalescedEvents();
            if (events.length > 0) {
                for (let e of events) {
                    const { x, y } = this.getMousePos(event);
                    if (this.lastPoint.x === x && this.lastPoint.y === y) {
                        continue;
                    }
                    this.drawLine(this.lastPoint, { x, y });
                    this.lastPoint = { x, y };
                }
                return;
            }
        }
        const { x, y } = this.getMousePos(event);
        this.drawLine(this.lastPoint, { x, y });
        this.lastPoint = { x, y };
    }

    getMousePos(event) {
        const rect = this.twoBitCanvas.getBoundingClientRect();
        return {
            x: convertCoordinate(event.clientX, rect.left, rect.width, this.twoBitCanvas.width),
            y: convertCoordinate(event.clientY, rect.top, rect.height, this.twoBitCanvas.height)
        };
    }

    getTiles() {
        return this.tileMap.tileSet;
    }

    setTwoBitData(twoBitData) {
        if (twoBitData.length != this.width * this.height) {
            return;
        }
        this.tileMap.tileSet
        this.twoBitCanvas.setTwoBitData(twoBitData);
    }

    getGBData() {
        return this.tileMap.toGBData();
    }
    
    fromGBData(tileMap, tiles) {
        this.tileMap.fromGBData(tileMap, tiles);
        this.needRedraw = true;
    }

    getB64JSONGBData() {
        const {map, tiles} = this.getGBData();
        const encodedGBData = {
            map: arrayBufferToBase64(map),
            tiles: arrayBufferToBase64(tiles),
        };
        return JSON.stringify(encodedGBData);
    }

    fromB64JSONGBData(jsonGBData) {
        const encodedGBData = JSON.parse(jsonGBData);
        this.fromGBData(base64ToUint8Array(encodedGBData.map),
                        base64ToUint8Array(encodedGBData.tiles));
    }

    getNextTile() {
        const tileIndex = this.nextTile;
        this.selectedTile = tileIndex;
        this.nextTile++;
        this.dispatchEvent(new CustomEvent('tileSelected', { detail: tileIndex }));
    }
}
customElements.define('two-bit-drawing', TwoBitDrawing);

export {
    TwoBitDrawing,
    PENCIL,
    TILE_SELECT,
}