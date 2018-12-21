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

const VERTEX_SHADER_SOURCE = `
precision mediump float;

// Instanced
attribute vec2 coord;
attribute vec3 colour;

attribute vec2 vertexPosition;

uniform vec2 scale; 

varying vec3 varyingColour;

void main() {
    gl_Position = vec4(scale * (coord + vertexPosition), 0.0, 1.0);
    varyingColour = colour;
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

varying vec3 varyingColour;

void main() {
    gl_FragColor = vec4(varyingColour, 1.0);
}
`;

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
    lastMs: number | undefined;

    constructor(canvas: HTMLCanvasElement, sunflower: Sunflower) {
        this.canvas = canvas;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            throw new Error("Cannot get canvas context.");
        }
        this.ctx = ctx;
        ctx.fillStyle = 'rgb(245, 164, 74)';
        ctx.font = "16px Arial";
        this.sunflower = sunflower;
        this.width = canvas.width;
        this.height = canvas.height;
        this.size = Math.max(this.width, this.height);
        requestAnimationFrame(this.render);
    }

    render = (_time: number) => {
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

class Sunflower3DRenderer {
    canvas: HTMLCanvasElement;
    sunflower: Sunflower;
    gl: WebGLRenderingContext;
    
    width: number;
    height: number;
    size: number;
    lastMs: number | undefined;

    // We don't need scaleLocation as we assume it won't change.
    // scaleLocation: WebGLUniformLocation;
    coordLocation: GLuint;
    colourLocation: GLuint;

    coordArray: Float32Array;
    colourArray: Float32Array;

    coordBuffer: WebGLBuffer;
    colourBuffer: WebGLBuffer;

    vertexPositionLocation: GLuint;

    indexCount: number;
    instanceExt: ANGLE_instanced_arrays;

    constructor(canvas: HTMLCanvasElement, sunflower: Sunflower, circleSlices: number = 16) {
        this.canvas = canvas;
        const gl = canvas.getContext("webgl");
        if (gl === null) {
            throw new Error("Cannot get WebGL context.");
        }
        this.gl = gl;
        this.sunflower = sunflower;
        this.width = canvas.width;
        this.height = canvas.height;
        this.size = Math.max(this.width, this.height);

        const instanceExt = gl.getExtension("ANGLE_instanced_arrays");
        if (instanceExt === null) {
            throw new Error("I need instancing!");
        }
        this.instanceExt = instanceExt;

        // Time for some fun boilerplate!
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(1, 1, 1, 1);
        // We don't need to enable depth test / back face culling.
        
        // Compiling shaders
        // As we're not using multiple programs, there's no need to store this
        // around for rendering.
        const program = (() => {
            const vertexShader = gl.createShader(gl.VERTEX_SHADER);
            if (vertexShader === null) {
                throw new Error("Cannot create vertex shader?");
            }
            gl.shaderSource(vertexShader, VERTEX_SHADER_SOURCE);
            gl.compileShader(vertexShader);
            if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
                throw new Error(
                    "Vertex shader compilation failed.\n" +
                    "The error log is:\n" +
                    (gl.getShaderInfoLog(vertexShader) || "null???")
                );
            }

            const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
            if (fragmentShader === null) {
                throw new Error("Cannot create fragment shader?");
            }
            gl.shaderSource(fragmentShader, FRAGMENT_SHADER_SOURCE);
            gl.compileShader(fragmentShader);
            if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
                throw new Error(
                    "Fragment shader compilation failed.\n" +
                    "The error log is:\n" +
                    (gl.getShaderInfoLog(fragmentShader) || "null???")
                );
            }

            const program = gl.createProgram();
            if (program === null) {
                throw new Error("Cannot create GL program?");
            }
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);

            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                throw new Error(
                    "Shader linking failed.\n" +
                    "The error log is:\n" +
                    (gl.getProgramInfoLog(program) || "null???")
                );
            }

            return program;
        })();
        gl.useProgram(program);

        // Getting uniforms
        {
            const uniformLocation = (name: string) => {
                const location = gl.getUniformLocation(program, name);
                if (location === null) {
                    throw new Error(`Cannot get uniform location for ${name}.`);
                }
                return location;
            }
            const scaleLocation = uniformLocation("scale");
            // Set scaleLocation.
            gl.uniform2f(scaleLocation, this.size / this.width, this.size / this.height);
        }

        // Getting attributes
        this.vertexPositionLocation = gl.getAttribLocation(program, "vertexPosition");
        this.coordLocation = gl.getAttribLocation(program, "coord");
        this.colourLocation = gl.getAttribLocation(program, "colour");

        // Setting vertex buffers and index buffers
        {
            const createBuffer = () => {
                const buf = gl.createBuffer();
                if (buf === null) {
                    throw new Error("Error when creating GL buffer??");
                }
                return buf;
            };
            const vertexPoints: number[] = [];
            // Push the center on.
            vertexPoints.push(0, 0);
            for (let i = 0; i < circleSlices; i++) {
                // Push the outside point on.
                const theta = 2 * Math.PI * i / circleSlices;
                vertexPoints.push(CIRCLE_SIZE * Math.cos(theta), CIRCLE_SIZE * Math.sin(theta));
            }
            // OK, let's turn it into an array buffer!
            const vertexPointsBuffer = createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertexPointsBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexPoints), gl.STATIC_DRAW);
            // and assign it to the vertex attrib.
            gl.vertexAttribPointer(this.vertexPositionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(this.vertexPositionLocation);
            instanceExt.vertexAttribDivisorANGLE(this.vertexPositionLocation, 0);


            // We want our circle to have a point in the center, with other
            // points scattered on the outside. We'll draw it with gl.TRIANGLE_FAN.
            // Because we only have one single vertex buffer (the location),
            // we can use the "first" vertex as the last one too.
            // If we had texture coordinates or something, this wouldn't work!
            const indices = [0];
            for (let i = 1; i <= circleSlices; i++) {
                indices.push(i);
            }
            indices.push(1);

            // OK, let's turn it into an index buffer and bind it!
            const indexBuffer = createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

            // We also need the count of indices for drawing.
            this.indexCount = indices.length;


            // Now... for the instancing.
            // How many points do we have?
            const n = sunflower.points.length;
            // Lets set up our arrays first.
            this.coordArray = new Float32Array(n * 2);
            this.colourArray = new Float32Array(n * 3);
            // coordArray will be filled per call.
            // colourArray should be filled per call, but for now let's fill
            // it up.
            for (let i = 0; i < n; i++) {
                this.colourArray[3*i + 0] = 245/255;
                this.colourArray[3*i + 1] = 164/255;
                this.colourArray[3*i + 2] = 74/255;
            }

            // Okay, let's set up the buffers.
            this.coordBuffer = createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.coordBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.coordArray, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(this.coordLocation, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(this.coordLocation);
            instanceExt.vertexAttribDivisorANGLE(this.coordLocation, 1);

            this.colourBuffer = createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.colourBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.colourArray, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(this.colourLocation, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(this.colourLocation);
            instanceExt.vertexAttribDivisorANGLE(this.colourLocation, 1);
        }
        

        requestAnimationFrame(this.render);
    }

    render = (_time: number) => {
        const gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT); // We aren't doing depth tests.
        const n = this.sunflower.points.length;
        for (let i = 0; i < n; i++) {
            const point = this.sunflower.points[i].curPos;
            this.coordArray[2*i + 0] = point.x;
            this.coordArray[2*i + 1] = point.y;
        }
        // We don't need to call bindBuffer every time render is called...
        // but if we introduce per-point colours, we would need to.
        gl.bindBuffer(gl.ARRAY_BUFFER, this.coordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.coordArray, gl.DYNAMIC_DRAW);
        this.instanceExt.drawElementsInstancedANGLE(gl.TRIANGLE_FAN, this.indexCount, gl.UNSIGNED_SHORT, 0, n);

        this.sunflower.nextFrame();
        requestAnimationFrame(this.render);
    }
}

window.addEventListener("load", () => {
    const canvas = document.getElementById("canvas");
    if (canvas === null) {
        throw new Error("Can't find canvas!");
    }
    if (!isCanvas(canvas)) {
        throw new Error("Canvas isn't a canvas element!");
    }
    const renderer = new Sunflower3DRenderer(canvas, new Sunflower(MAX_POINTS));
});
