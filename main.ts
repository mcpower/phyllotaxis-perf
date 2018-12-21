const MAX_POINTS = 1000;

const CIRCLE_SIZE = 0.008 * 2;

const MAX_TIME = 4;
const SECONDS_PER_TIME = 1000;
// Assume 60fps.
const FRAMES_PER_SECOND = 60;
const FRAMES_PER_TIME = SECONDS_PER_TIME * FRAMES_PER_SECOND;
const INITIAL_TIME = 0.1;
const INITIAL_FRAME = INITIAL_TIME * SECONDS_PER_TIME * FRAMES_PER_SECOND;
const MAX_FRAME = MAX_TIME * FRAMES_PER_TIME;


// note that the "size" of the viewport we're working with
// [-1, 1] x [-1, 1]
// is 2
const DIST_MULTIPLIER = 0.020 * 2;
const ANGLE_MULTIPLIER = 2 * Math.PI / MAX_TIME;

interface Point {
    x: number;
    y: number;
}

interface SpiralPoint {
    curPos: Point;
    deltaPos: Point;
    initPos: Point;
    // rippleD will be currently unused.
    rippleD: number;
}

function isCanvas(canvas: HTMLElement): canvas is HTMLCanvasElement {
    return (<HTMLCanvasElement>canvas).getContext !== undefined;
}

class Sunflower {
    points: SpiralPoint[];
    frame: number;

    constructor(points: number) {
        // warning: const (mutable) array!
        this.points = [];
        this.frame = 0;

        for (let i = 0; i < points; i++) {
            const dist = DIST_MULTIPLIER * Math.sqrt(i);
            // Avoid rendering points out of the viewport.
            if (dist > Math.SQRT2 + CIRCLE_SIZE) break;
            // This is the setup, so we can do some expensive math here.
            // (read: I'm too lazy to figure out)
            const pointAngleMultiplier = ANGLE_MULTIPLIER * i;

            const angle = pointAngleMultiplier * INITIAL_TIME;
            const initPos: Point = {
                x: dist * Math.cos(angle),
                y: dist * Math.sin(angle)
            };
            // How much does the angle change per frame?
            const deltaAngle = pointAngleMultiplier / FRAMES_PER_TIME;
            const deltaPos: Point = {
                x: Math.cos(deltaAngle),
                y: Math.sin(deltaAngle)
            };

            this.points.push({
                curPos: {...initPos},
                deltaPos,
                initPos,
                rippleD: 0
            });
        }
    }

    nextFrame(): void {
        this.frame++;
        if (this.frame === MAX_FRAME) {
            console.log("Resetting frame!");
            this.frame = 0;
            for (let i = 0; i < this.points.length; i++) {
                const point = this.points[i];
                point.curPos.x = point.initPos.x;
                point.curPos.y = point.initPos.y;
            }
            return;
        }
        for (let i = 0; i < this.points.length; i++) {
            const point = this.points[i];
            const {x: oldX, y: oldY} = point.curPos;
            const {x: dX, y: dY} = point.deltaPos;

            // cos(a + b) = cos(a)cos(b) - sin(a)sin(b)
            point.curPos.x = oldX * dX - oldY * dY;
            // sin(a + b) = sin(a)cos(b) + cos(a)sin(b)
            point.curPos.y = oldY * dX + oldX * dY;
        }
    }
}

class Sunflower2DRenderer {
    canvas: HTMLCanvasElement;
    sunflower: Sunflower;
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
    size: number;

    constructor(canvas: HTMLCanvasElement, sunflower: Sunflower) {
        this.canvas = canvas;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            throw new Error("Cannot get canvas context.");
        }
        this.ctx = ctx;
        ctx.fillStyle = 'rgb(200, 0, 0)';
        this.sunflower = sunflower;
        this.width = canvas.width;
        this.height = canvas.height;
        this.size = Math.max(this.width, this.height);
        this.render();
    }

    render = () => {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);
        for (let i = 0; i < this.sunflower.points.length; i++) {
            const point = this.sunflower.points[i].curPos;
            ctx.beginPath();
            ctx.arc(this.width / 2 + point.x * this.size / 2, this.height / 2 - point.y * this.size / 2, CIRCLE_SIZE / 2 * this.size, 0, 2*Math.PI, false);
            ctx.fill();
        }
        this.sunflower.nextFrame();
        requestAnimationFrame(this.render);
    }
}

window.addEventListener("load", () => {
    const canvas2D = document.getElementById("2d-canvas");
    if (canvas2D === null) {
        throw new Error("Can't find canvas!");
    }
    if (!isCanvas(canvas2D)) {
        throw new Error("Canvas isn't a canvas element!");
    }
    const renderer2D = new Sunflower2DRenderer(canvas2D, new Sunflower(MAX_POINTS));
});
