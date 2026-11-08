// validation

function scaleReferencePoint(context, point) {
   const { rect } = context;
   const scale = rect.width / 109
   return { x: point.x * scale, y: point.y * scale }
}

function scaleInputPoint(context, point) {
   const { rect } = context;
   const scale = 109 / rect.width 
   return { x: point.x * scale, y: point.y * scale }
}

function getDistance(p1, p2) {
   return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function resampleStroke(stroke, targetCount) {
   if (stroke.length < 2 || targetCount < 2) return stroke;

   // Step A: Calculate total length and segments
   let totalLength = 0;
   const segments = [];
   for (let i = 0; i < stroke.length - 1; i++) {
      const dist = getDistance(stroke[i], stroke[i + 1]);
      totalLength += dist;
      segments.push({ start: stroke[i], end: stroke[i + 1], length: dist, cumulative: totalLength });
   }

   // Handle edge case where user clicks down and doesn't move
   if (totalLength === 0) {
      return Array(targetCount).fill(null).map(() => ({ x: stroke[0].x, y: stroke[0].y }));
   }

   // Step B: Crawl along the path collecting evenly spaced points
   const interval = totalLength / (targetCount - 1);
   const resampledPoints = [stroke[0]]; // Always include exact start point

   let currentSegmentIdx = 0;

   for (let i = 1; i < targetCount - 1; i++) {
      const targetDistance = i * interval;

      // Find which segment holds this distance target
      while (currentSegmentIdx < segments.length && segments[currentSegmentIdx].cumulative < targetDistance) {
         currentSegmentIdx++;
      }

      // Interpolate cleanly between that specific segment
      const seg = segments[Math.min(currentSegmentIdx, segments.length - 1)];
      const prevCumulative = currentSegmentIdx === 0 ? 0 : segments[currentSegmentIdx - 1].cumulative;
      const segmentProgress = (targetDistance - prevCumulative) / (seg.length || 1);

      resampledPoints.push({
         x: seg.start.x + (seg.end.x - seg.start.x) * segmentProgress,
         y: seg.start.y + (seg.end.y - seg.start.y) * segmentProgress
      });
   }

   resampledPoints.push(stroke[stroke.length - 1]); // Always include exact end point
   return resampledPoints;
}

function gradeStrokeDirection(input, target) {
   // returns %, 100 is same direction, 50 perpendicular, 0 opposite

   const uStart = input[0];
   const uEnd = input[target.length - 1];

   const rStart = target[0];
   const rEnd = target[target.length - 1];

   const uVector = { x: uEnd.x - uStart.x, y: uEnd.y - uStart.y };
   const rVector = { x: rEnd.x - rStart.x, y: rEnd.y - rStart.y };

   const uLen = Math.sqrt(uVector.x * uVector.x + uVector.y * uVector.y) || 1;
   const rLen = Math.sqrt(rVector.x * rVector.x + rVector.y * rVector.y) || 1;

   const dotProduct = (uVector.x * rVector.x + uVector.y * rVector.y) / (uLen * rLen);
   return ((dotProduct + 1) / 2) * 100;
}

function gradeStrokeLength(input, target) {
   // returns %, deviation by maxDeviationFactor results in 0
   const maxDeviationFactor = 6; 

   let inputLength = 0;
   for (let k = 0; k < input.length - 1; k++) {
      inputLength += getDistance(input[k], input[k + 1]);
   }

   let targetLength = 0;
   for (let k = 0; k < target.length - 1; k++) {
      targetLength += getDistance(target[k], target[k + 1]);
   }

   const maxLen = Math.max(inputLength, targetLength);
   const minLen = Math.min(inputLength, targetLength);
   const ratio = maxLen / minLen;
   const alignment = 1 - (ratio - 1) / (maxDeviationFactor - 1);

   return Math.max(0, alignment) * 100;
}

function gradeStrokeShape(input, target) {
   if (input.length === 0 || target.length === 0) return 0;

   const wobbleForgiveness = 0.10; // 5% of the bounding box size
   const maxDistanceThreshold = 0.70; // 15% deviation maximum before 0% score

   // Helper to extract bounding box dimensions
   const getBounds = (stroke) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < stroke.length; i++) {
         const p = stroke[i];
         if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
         if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      const width = maxX - minX || 1; // Avoid division by zero
      const height = maxY - minY || 1;
      return { minX, minY, width, height, maxDim: Math.max(width, height) };
   };

   const tBounds = getBounds(target);
   const uBounds = getBounds(input);

   // 1. Normalize the Target stroke into a 0 to 1 bounding square space
   const normalizedTarget = target.map(p => ({
      x: (p.x - tBounds.minX) / tBounds.maxDim,
      y: (p.y - tBounds.minY) / tBounds.maxDim
   }));

   let totalShapeScore = 0;
   
   for (let j = 0; j < input.length; j++) {
      const uPt = {
         x: (input[j].x - uBounds.minX) / uBounds.maxDim,
         y: (input[j].y - uBounds.minY) / uBounds.maxDim
      };

      let minDistanceToPath = Infinity;
      for (let k = 0; k < normalizedTarget.length; k++) {
         const tPt = normalizedTarget[k];
         const dx = uPt.x - tPt.x;
         const dy = uPt.y - tPt.y;
         
         const dist = Math.sqrt(dx * dx + dy * dy);
         if (dist < minDistanceToPath) {
            minDistanceToPath = dist;
         }
      }

      const penalizedDistance = Math.max(0, minDistanceToPath - wobbleForgiveness);
      const pointScore = Math.max(0, 1 - (penalizedDistance / maxDistanceThreshold));
      totalShapeScore += pointScore;
   }

   return (totalShapeScore / input.length) * 100;
}

function gradeStroke(context, idx) {
   if (idx >= referenceKanji.length) {
      const directionScore = 0;
      const lengthScore = 0;
      const shapeScore = 0;
      return { directionScore, lengthScore, shapeScore };
   }

   const referenceStroke = referenceKanji[idx];

   const stroke = window.AnkiStrokes[idx];
   const scaledStroke = stroke.map(point => scaleInputPoint(context, point));;
   const resampledStroke = resampleStroke(scaledStroke, referenceStroke.length);

   const directionScore = gradeStrokeDirection(resampledStroke, referenceStroke);
   const lengthScore = gradeStrokeLength(resampledStroke, referenceStroke);
   const shapeScore = gradeStrokeShape(resampledStroke, referenceStroke);

   // console.log(directionScore, lengthScore, shapeScore);

   return { directionScore, lengthScore, shapeScore };
}






function getGradedColour(inn, idx) {
   const { directionScore, lengthScore, shapeScore } = inn;
   // const avgScore = (directionScore + lengthScore + shapeScore) / 3;
   
   const avgScore = Math.min(directionScore, lengthScore, shapeScore);
   const color = getColour(idx);

   let badColour
   if (CONFIG.stroke_order_gradient == 'mono') {
      badColour = "oklch(62.8% 0.2577 29.23)";
   } else {
      badColour = "oklch(0.2 0 none)";
   }

   let strokeStyle = color;
   if (avgScore < 80) {
      const reductionPercent = Math.min((100 - avgScore) * 1.5, 100);
      strokeStyle = `color-mix(in oklch, ${color}, ${badColour} ${reductionPercent}%)`;
      // strokeStyle = `color-mix(in oklch, ${color}, oklch(0.69 0.20 25) ${reductionPercent}%)`;
   }

   return strokeStyle;
}




// setup

const referenceKanji = (new Function(`return (${`{{ReferenceData}}`})`))();
const structuralData = (new Function(`return (${`{{StructuralData}}`})`))();
const componentBreakdown = (new Function(`return (${`{{Breakdown}}`})`))();
const isFrontSide = document.querySelector("main").classList.contains("front")

function initContext(id) {
   let canvas = document.getElementById(id);
   if (!canvas) return;
   
   const dpr = window.devicePixelRatio || 1;
   const rect = canvas.getBoundingClientRect();
   
   canvas.width = rect.width * dpr;
   canvas.height = rect.height * dpr;
   
   const ctx = canvas.getContext('2d');
   ctx.scale(dpr, dpr);
   ctx.clearRect(0, 0, rect.width, rect.height);

   ctx.lineCap = "round";
   ctx.lineJoin = "round";  
   
   return { canvas, ctx, rect };
}


// stroke rendering

function getColour(idx) {
   if (CONFIG.stroke_order_gradient == 'mono') {
      const progress = idx / (referenceKanji.length - 1);
      const lightness = 0.85 - (progress * 0.70); 
      return `oklch(${lightness} 0.0 250)`; 
   } else {
      const hue = ((idx / referenceKanji.length) + 0.08) * 320;
      return `oklch(0.69 0.20 ${hue})`;
   }
}


function renderStroke(context, stroke) {
   if (stroke.length < 2) return;
   const { ctx } = context;

   ctx.beginPath();
   ctx.moveTo(stroke[0].x, stroke[0].y);
   for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
   }

   ctx.stroke(); 
}


function renderStroke(context, stroke) {
   if (stroke.length < 2) return;
   const { ctx } = context;

   // Configure your desired stroke limits
   const MAX_WIDTH = ctx.lineWidth; 
   const MIN_WIDTH = MAX_WIDTH * 0.8;
   
   // Tapering distances in pixels (adjust these to make tapers longer or shorter)
   const START_TAPER_PX = CONFIG.stroke_line_width * 1; 
   const END_TAPER_PX = CONFIG.stroke_line_width * 2;

   const widths = new Array(stroke.length);
   
   // Pre-pass 1: Calculate cumulative pixel distance along the stroke path
   const distances = new Array(stroke.length);
   distances[0] = 0;
   for (let i = 1; i < stroke.length; i++) {
      const dist = Math.hypot(stroke[i].x - stroke[i-1].x, stroke[i].y - stroke[i-1].y);
      distances[i] = distances[i - 1] + dist;
   }
   const totalLength = distances[stroke.length - 1];

   // Pre-pass 2: Apply the identical geometric taper profile based purely on distance
   for (let i = 0; i < stroke.length; i++) {
      let targetWidth = MAX_WIDTH;

      const dFromStart = distances[i];
      const dFromEnd = totalLength - distances[i];

      if (dFromStart < START_TAPER_PX && totalLength > START_TAPER_PX) {
         // Smoothly scale up from MIN_WIDTH at the absolute beginning
         const factor = dFromStart / START_TAPER_PX;
         targetWidth = MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * factor;
         
      } else if (dFromEnd < END_TAPER_PX && totalLength > END_TAPER_PX) {
         // Smoothly scale down to MIN_WIDTH at the absolute end
         const factor = dFromEnd / END_TAPER_PX;
         targetWidth = MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * factor;
      }

      widths[i] = targetWidth;
   }

   // Render the path smoothly using midpoints to prevent ugly overlapping joint blobs
   if (stroke.length === 2) {
      ctx.beginPath();
      ctx.lineWidth = widths[0];
      ctx.moveTo(stroke[0].x, stroke[0].y);
      ctx.lineTo(stroke[1].x, stroke[1].y);
      ctx.stroke();
      ctx.restore();
      return;
   }

   for (let i = 1; i < stroke.length - 1; i++) {
      const p0 = stroke[i - 1];
      const p1 = stroke[i];
      const p2 = stroke[i + 1];

      const mid1X = (p0.x + p1.x) / 2;
      const mid1Y = (p0.y + p1.y) / 2;
      const mid2X = (p1.x + p2.x) / 2;
      const mid2Y = (p1.y + p2.y) / 2;

      ctx.beginPath();
      ctx.lineWidth = widths[i];
      ctx.moveTo(mid1X, mid1Y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2X, mid2Y);
      ctx.stroke();
   }

   // Connect cleanly to the final point
   const lastIdx = stroke.length - 1;
   const secondToLast = stroke[lastIdx - 1];
   const last = stroke[lastIdx];
   const finalMidX = (secondToLast.x + last.x) / 2;
   const finalMidY = (secondToLast.y + last.y) / 2;

   ctx.beginPath();
   ctx.lineWidth = widths[lastIdx];
   ctx.moveTo(finalMidX, finalMidY);
   ctx.lineTo(last.x, last.y);
   ctx.stroke();
}



function renderColourStroke(context, stroke) {
   const { ctx } = context
   if (stroke.length < 2) return;

   const originalWidth = ctx.lineWidth;
   const originalColor = ctx.strokeStyle;

   ctx.save();

   // glow
   // ctx.lineWidth = originalWidth;
   // const offset = 9999;
   // ctx.shadowBlur = 12;
   // ctx.shadowOffsetX = 0;
   // ctx.shadowOffsetY = offset;
   // ctx.shadowColor = `color-mix(in srgb, ${originalColor} 15%, transparent)`; 
   // ctx.translate(0, -offset); 
   // renderStroke(context, stroke);
   // ctx.translate(0, offset);
   // ctx.shadowColor = "transparent"; 
   // ctx.shadowOffsetY = 0;

   // outline
   const outlineThickness = 1;
   ctx.lineWidth = originalWidth + (outlineThickness * 2);
   ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
   renderStroke(context, stroke);

   // line itself
   ctx.lineWidth = originalWidth;
   ctx.strokeStyle = originalColor;
   renderStroke(context, stroke);

   ctx.restore();
}


function drawDotHint(context, stroke) {
   const { ctx } = context;
   let p0 = stroke[0];
   
   const radius = CONFIG.stroke_line_width * 0.5;
   const outlineThickness = 1; 
   const coreColor = ctx.strokeStyle;

   ctx.save(); 

   ctx.beginPath();
   ctx.arc(p0.x, p0.y, radius + outlineThickness, 0, Math.PI * 2);
   ctx.fillStyle = "#ffffff";
   ctx.fill();

   ctx.beginPath();
   ctx.arc(p0.x, p0.y, radius, 0, Math.PI * 2);
   ctx.fillStyle = coreColor; 
   ctx.fill(); 

   ctx.restore();  
}   


// canvas specific

if (isFrontSide) {
   const strokeChangeListeners = [];

   window.AnkiStrokes = new Proxy([], {
      set(target, property, value, receiver) {
         const success = Reflect.set(target, property, value, receiver);
         if (property === 'length') {
            strokeChangeListeners.forEach(callback => callback(target.length));
         }
         return success;
      }
   });

   globalThis._onStrokesChange = function(callback) {
      strokeChangeListeners.push(callback);
      callback(window.AnkiStrokes.length);
   }
}


// input canvas specific


function initDrawingCanvas(id) {
   const context = initContext(id);
   if (!context) return;

   const { canvas, ctx, rect } = context;
   const strokeColor = "oklch(0.2 0 none)";
   // const strokeColor = getRandomColour();
   // const strokeColor = "oklch(69% 0.10 273.13deg)";
   ctx.lineWidth = CONFIG.stroke_line_width;
 
   let isDrawing = false;
   let currentStroke = [];

   function getPos(e) {
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: Date.now() };
   }

   function smoothStroke(points, passes) {
      const len = points.length;
      if (len < 2) return points;
      
      // 1. Decimation Filter
      const filteredPoints = [points[0]];
      let lastSaved = points[0];
      const distanceThresholdSq = 5 ** 2;

      for (let i = 1; i < len; i++) {
         const p1 = points[i];
         const dx = p1.x - lastSaved.x;
         const dy = p1.y - lastSaved.y;
         
         if (dx * dx + dy * dy >= distanceThresholdSq || i === len - 1) {
            filteredPoints.push(p1);
            lastSaved = p1;
         }
      }
      
      // 2. Chaikin's Smoothing
      let result = filteredPoints;
      for (let p = 0; p < passes; p++) {
         const rLen = result.length;
         if (rLen < 3) break;
         
         const nextPass = new Array((rLen - 2) * 2 + 2); 
         nextPass[0] = result[0];
         
         let index = 1;
         for (let i = 0; i < rLen - 1; i++) {
            const p0 = result[i];
            const p1 = result[i + 1];
            
            // Left cut (75% p0, 25% p1)
            nextPass[index++] = {
               x: p0.x * 0.75 + p1.x * 0.25,
               y: p0.y * 0.75 + p1.y * 0.25,
               t: p0.t * 0.75 + p1.t * 0.25
            };
            
            // Right cut (25% p0, 75% p1)
            nextPass[index++] = {
               x: p0.x * 0.25 + p1.x * 0.75,
               y: p0.y * 0.25 + p1.y * 0.75,
               t: p0.t * 0.25 + p1.t * 0.75
            };
         }
         nextPass[index] = result[rLen - 1];
         result = nextPass;
      }
      
      return result;
   }

   globalThis._onStrokesChange((currentCount) => {
      if (window.AnkiStrokes.length == 0 && CONFIG.hint_first_stroke_start) {

         const scaledStroke = referenceKanji[0].map(point => scaleReferencePoint(context, point));
         ctx.strokeStyle = getColour(0);
         drawDotHint(context, scaledStroke);

      }

      if (CONFIG._experimental) showComponent(currentCount);

      if (window.AnkiStrokes.length == referenceKanji.length) {
         setTimeout(() => {
            if (window.AnkiStrokes.length == referenceKanji.length && CONFIG._experimental) flipToBack();
         }, 600);
      }
   });


   function redrawCanvas() {
      ctx.clearRect(0, 0, rect.width, rect.height);

      ctx.strokeStyle = strokeColor;

      window.AnkiStrokes.forEach((stroke, idx) => {
         ctx.strokeStyle = strokeColor;
         ctx.lineWidth = CONFIG.stroke_line_width;
         renderStroke(context, stroke)
      });  
   }

   canvas.addEventListener("pointerdown", (e) => {
      isDrawing = true;
      const startPos = getPos(e);
      currentStroke = [startPos];
      
      ctx.beginPath();
      ctx.moveTo(startPos.x, startPos.y);
   });
   
   canvas.addEventListener("pointermove", (e) => {
      if (!isDrawing) return;
      currentStroke.push(getPos(e));
      redrawCanvas();
      const smoothPoints = smoothStroke(currentStroke, CONFIG.stroke_smoothing_passes);
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = CONFIG.stroke_line_width;
      renderStroke(context, smoothPoints);
   });
   
   window.addEventListener("pointerup", () => {
      if (!isDrawing) return;
      isDrawing = false;
      const smoothedStroke = smoothStroke(currentStroke, CONFIG.stroke_smoothing_passes);
      if (smoothedStroke.length > 2) window.AnkiStrokes.push(smoothedStroke);
      redrawCanvas();
   });

   const undoBtn = document.getElementById("undoBtn");
   const undoBtnText = undoBtn.textContent;
   let longPressTimeout = null;
   let isLongPress = false;

   undoBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      isLongPress = false;

      undoBtn.textContent = "🧽";

      longPressTimeout = setTimeout(() => {
         isLongPress = true;
         
         window.AnkiStrokes.length = 0;
         ctx.clearRect(0, 0, rect.width, rect.height);
         undoBtn.textContent = undoBtnText;
      }, 500); 
   });

   undoBtn.addEventListener("pointerup", (e) => {
      e.preventDefault();
      clearTimeout(longPressTimeout);

      undoBtn.textContent = undoBtnText;

      if (!isLongPress) {
         window.AnkiStrokes.pop();
         redrawCanvas();
      }
   });

   undoBtn.addEventListener("pointerleave", () => {
      clearTimeout(longPressTimeout);
      undoBtn.textContent = undoBtnText;
   });


   document.getElementById("hintBtn").addEventListener("click", (e) => {
      e.preventDefault();

      const randomComponent = getRandomComponent();

      if (randomComponent) {
         const b = document.getElementById("hintBtn")
         b.innerText = randomComponent;
      }

      window.__hasShownHint = true;
   });

}



// rendering input on the back

function initResultCanvas(id) {
   const context = initContext(id);
   if (!context) return;

   const { canvas, ctx, rect } = context;
   const strokeColor = "#000000";
   ctx.lineWidth = CONFIG.stroke_line_width + 0.5;

   function redrawCanvas() {
      ctx.clearRect(0, 0, rect.width, rect.height);

      ctx.strokeStyle = strokeColor;
      window.AnkiStrokes.forEach((stroke, idx) => {
         const score = gradeStroke(context, idx);
         ctx.strokeStyle = getGradedColour(score, idx);

         renderColourStroke(context, stroke);
         drawDotHint(context, stroke);
      });
   }

   let endScore = 0;
   window.AnkiStrokes.forEach((stroke, idx) => {
      const { directionScore, lengthScore, shapeScore } = gradeStroke(context, idx);
      endScore += (directionScore + lengthScore + shapeScore) / 3
      // endScore = Math.min(endScore, (directionScore + lengthScore + shapeScore) / 3)
   });  

   endScore = Math.round(endScore / referenceKanji.length);
   if (window.AnkiStrokes.length != referenceKanji.length) endScore = 0;
   if (window.__hasShownDiagram) endScore = -1;

   let scoreBox = document.getElementById('kanjiScoreBox');
   let color = "#e74c3c";

   if (endScore >= 90) color = "#2ecc71";
   else if (endScore >= 60) color = "#f39c12"; 

   scoreBox.innerHTML = `<span style="color:${color};font-weight:bold;">${endScore}</span> スコア`;
   
   redrawCanvas();
}




const getRandomComponent = (() => {
   // Fisher-Yates Shuffle, no repeats across resets

   let availableKeys = [];
   let lastPickedKey = null;

   return function() {
      if (availableKeys.length === 0) {
         const allKeys = Object.keys(componentBreakdown);
         
         if (allKeys.length === 0) return null;

         for (let i = allKeys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allKeys[i], allKeys[j]] = [allKeys[j], allKeys[i]];
         }

         if (allKeys.length > 1 && allKeys[allKeys.length - 1] === lastPickedKey) {
            [allKeys[allKeys.length - 1], allKeys[0]] = [allKeys[0], allKeys[allKeys.length - 1]];
         }

         availableKeys = allKeys;
      }

      lastPickedKey = availableKeys.pop();
      return componentBreakdown[lastPickedKey];
   };
})();



function splitmix32(a) {
    return function() {
        a |= 0; a = a + 0x9e3779b9 | 0;
        let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
        t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97);
        return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
    }
}


function initReferenceCanvas(id) {
   const context = initContext(id);
   if (!context) return;

   const { canvas, ctx, rect } = context;
   ctx.lineWidth = CONFIG.stroke_line_width;

   function redrawReferenceCanvas() {
      ctx.clearRect(0, 0, rect.width, rect.height);
      drawCanvasElement = document.getElementById('drawCanvas');
      if (drawCanvasElement) drawCanvasElement.classList.remove("dimmedCanvas");
      
   }

   function drawStrokeDiagram() {
      referenceKanji.forEach((stroke, idx) => { 
         ctx.strokeStyle = getColour(idx);
         const scaledStroke = stroke.map(point => scaleReferencePoint(context, point));
         renderColourStroke(context, scaledStroke);
         drawDotHint(context, scaledStroke);
      });
   }

   let isShowingDiagram = false;


   if (isFrontSide) {
      window.__hasShownDiagram = false;
      window.__hasShownHint = false;

      globalThis._onStrokesChange((currentCount) => {
         redrawReferenceCanvas();
         isShowingDiagram = false;

         if (CONFIG._experimental) circleHell(context);

         if (isFrontSide && currentCount == 0) {
            // ctx.strokeStyle = "oklch(0.58 0.19 264.4)";
            // drawDotHint(context, referenceKanji[0], true);
         }
      });

      document.getElementById("diagramBtn").addEventListener("click", (e) => {
         e.preventDefault();

         if (isShowingDiagram) {
            redrawReferenceCanvas();
            isShowingDiagram = false;
         } else {
            redrawReferenceCanvas();
            drawStrokeDiagram();

            drawCanvasElement = document.getElementById('drawCanvas');
            if (drawCanvasElement) drawCanvasElement.classList.add("dimmedCanvas");

            isShowingDiagram = true;
            window.__hasShownDiagram = true;
         }
      });

   } else {
      redrawReferenceCanvas();
      drawStrokeDiagram();
   }
}


initReferenceCanvas('referenceCanvas');
initDrawingCanvas('drawCanvas');
initResultCanvas('resultCanvas');


// prompt text selection and handling

const kanji = "{{Kanji}}";

let callCounter = 0;
function getRandomSeededElement(arr) {
   if (!arr?.length) return "";

   const seed = Math.floor(Date.now() / 3600000) + callCounter;
   const rand = Math.sin(seed) * 10000;
   callCounter++;

   return arr[Math.floor((rand - Math.floor(rand)) * arr.length)];
}

function marufy(sentence) {
   if (!isFrontSide) return sentence;
   
   let index;
   const maskLength = CONFIG.text_kanji_mask.length;

   if (referenceKanji.length > 20) {
      index = maskLength - 1;
   } else {
      const step = 20 / maskLength;
      index = Math.max(0, Math.min(
         Math.floor((referenceKanji.length - 1) / step),
         maskLength - 1
      ));
   }

   const replacementCharacter = CONFIG.text_kanji_mask[index];
      
   return sentence.replaceAll(kanji, replacementCharacter);
}

function furiganify(text) {
   return text.replace(/([^\s[\]<>]+)\[([^\]]+)\]/g, '<ruby>$1<rt>$2</rt></ruby>');
}

const context = (new Function(`return (${`{{Context}}`})`))();

const context_container = document.getElementById("context-container");
context_container.innerHTML = furiganify(marufy(getRandomSeededElement(context)));

const promptWordContainer = document.getElementById("prompt-word");
const promptRestContainer = document.getElementById("prompt-rest");

const promptData = (new Function(`return (${`{{Prompt}}`})`))();
const keys = Object.keys(promptData);
const selectedKey = getRandomSeededElement(keys);

const targetArray = promptData[selectedKey];
const selectedValue = getRandomSeededElement(targetArray);

const restWords = [];

keys.forEach(key => {
   if (key === selectedKey) return;

   const currentArray = promptData[key];
   const candidate = getRandomSeededElement(currentArray);

   if (candidate) {
      restWords.push(furiganify(marufy(candidate)));
   }
});

if (isFrontSide) {
   promptWordContainer.innerHTML = furiganify(marufy(selectedValue));
   promptRestContainer.innerHTML = restWords.map(word => `<div>${word}</div>`).join("");
} else {
   let mainWord = furiganify(marufy(selectedValue));
   promptWordContainer.innerHTML = furiganify(marufy(selectedValue));
   // promptRestContainer.innerHTML = `<div>${mainWord}</div>` + restWords.map(word => `<div>${word}</div>`).join("");

   for (const strokeidx in componentBreakdown) {
      const component = componentBreakdown[strokeidx];

      const label = document.createElement('div');  
      label.innerText = component[0];
      label.style.opacity = 0.8;

      // if (previousStrokeidx) {
      //    label.style.color = getColour(parseInt(previousStrokeidx));
      // } else {
      //    previousStrokeidx = strokeidx;
      //    label.style.color = getColour(0);
      // }

      // promptWordContainer.appendChild(label);
      promptRestContainer.appendChild(label);
   }
}





// ============================= EXPERIMENTS =============================
// ==                                                                   ==
// ==                 abandon all hope ye who enter here                ==
// ==                                                                   ==
// =======================================================================



function flipToBack() {
   console.log('flip')
   if (typeof pycmd !== "undefined") {
      pycmd("ans");
   } else if (typeof AnkiDroidJS !== "undefined") {
      showAnswer();
   } else if (window.anki && window.sendMessage2) {
      window.sendMessage2("ankitap", "midCenter");
   } else if (typeof study !== "undefined") {
      study.drawAnswer();
   }
}




function showComponent(strokeidx) {
   let id = String(strokeidx);
   
   if (componentBreakdown[id]) {
      const currentComponent = document.getElementById("currentComponent");
      currentComponent.innerText = componentBreakdown[id];
      currentComponent.classList.remove("flash-active");
      currentComponent.offsetWidth;
      currentComponent.classList.add("flash-active");
   }
}




// function circleHell(context) {
//    const { ctx } = context

//    const DEFAULT_RADIUS = 16;
//    const BASE_STROKES = 10;
   
//    const SCALING_FACTOR = 0.05; 
//    const MIN_RADIUS = 6;

//    const strokeCount = referenceKanji.length;
//    const userCount = window.AnkiStrokes.length;

//    let multiplier;
//    if (strokeCount <= BASE_STROKES) {
//       multiplier = 1 / (1 - (BASE_STROKES - strokeCount) * SCALING_FACTOR);
//    } else {
//       multiplier = 1 - (strokeCount - BASE_STROKES) * SCALING_FACTOR;
//    }

//    // const radius = Math.max(MIN_RADIUS, DEFAULT_RADIUS * multiplier);

//    referenceKanji.forEach((stroke, idx) => {
//       let p0
//       let radius
//       let angle
//       let r

//       if (userCount < idx + 1) {
//          p0 = scaleReferencePoint(context, stroke[0]);
//          radius = Math.max(MIN_RADIUS, DEFAULT_RADIUS * multiplier);
//          const nextRandom = splitmix32(Math.round(p0.x * 100 + p0.y * 100 + idx))
//          angle = nextRandom() * 2 * Math.PI;
//          r = nextRandom() * radius;
//       } else {
//          p0 = window.AnkiStrokes[idx][0];
//          radius = MIN_RADIUS;
//          angle = 0;
//          r = 0;
//       }
      
//       const pC = {
//          x: p0.x + r * Math.cos(angle),
//          y: p0.y + r * Math.sin(angle)
//       };

//       const outlineThickness = 1; 
//       const coreColor = getColour(idx);

//       ctx.save(); 

//       ctx.beginPath();
//       ctx.arc(pC.x, pC.y, radius + outlineThickness, 0, Math.PI * 2);
//       ctx.fillStyle = "#ffffff";
//       ctx.fill();

//       ctx.beginPath();
//       ctx.arc(pC.x, pC.y, radius, 0, Math.PI * 2);
//       ctx.fillStyle =  `color-mix(in oklch, ${coreColor}, transparent 70%)`; 
//       ctx.fill(); 

//       ctx.restore();  
//    })
// }



// function circleHell(context) {
//    const { ctx } = context;

//    const radius = 6;

//    referenceKanji.forEach((stroke, idx) => {
//       const p0 = scaleReferencePoint(context, stroke[0]);
//       const p9 = scaleReferencePoint(context, stroke.at(-1));

//       ctx.save();
      
//       ctx.beginPath();
//       ctx.fillStyle = '#8e8e93';
//       ctx.arc(p0.x, p0.y, radius, 0, 2 * Math.PI);
//       ctx.arc(p9.x, p9.y, radius, 0, 2 * Math.PI);
//       ctx.fill();

//       ctx.restore();
//    });

//    structuralData.forEach((hint) => {
//       const { t, x, y } = hint;

//       // Handle coordinate space scaling transformation if present
//       const renderX = typeof scaleReferencePoint === 'function' ? scaleReferencePoint(context, { x, y }).x : x;
//       const renderY = typeof scaleReferencePoint === 'function' ? scaleReferencePoint(context, { x, y }).y : y;

//       ctx.save();
      
//       if (t === 'joint') {
//          ctx.fillStyle = '#8e8e93'; //'#ff3b30';
//       } else if (t === 'angle') {
//          ctx.fillStyle = '#8e8e93'; //'#007aff';
//       } else if (t === 'floater') {
//          ctx.fillStyle = '#8e8e93';
//       }

//       if (t != 'floater') {
//          ctx.beginPath();
//          ctx.arc(renderX, renderY, radius, 0, 2 * Math.PI);
//          ctx.fill();
//       }

//       ctx.restore();
//    });
// }


function calculateKanjiHeightmap(strokes, features, options = {}) {
   // 1. Destructure configurations with safe defaults matching your Python logic
   const gridSize = options.gridSize || 32;
   const canvasScale = options.canvasScale || 109;
   const featureWeight = options.featureWeight !== undefined ? options.featureWeight : 2.0;
   const pointWeight = options.pointWeight !== undefined ? options.pointWeight : 1.0;
   const influenceRadius = options.influenceRadius || 15.0;

   // 2. Initialize a clean 2D grid matrix of size [gridSize][gridSize] filled with zeros
   const heightmap = Array.from({ length: gridSize }, () => new Array(gridSize).fill(0.0));
   
   // Calculate spatial coordinate spacing between cell rows and columns
   const step = canvasScale / (gridSize - 1);
   
   // Flatten your array of arrays of points [[{x, y}, ...], [...]] into a single 1D array
   const normalPoints = strokes.flat();

   // 3. Loop through every row and column cell intersection in the coordinate grid matrix
   for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
         // Calculate absolute spatial canvas coordinates for this grid node intersection
         const gx = c * step;
         const gy = r * step;
         
         let nodeHeight = 0.0;

         // --- Tier A: Accumulate Regular Path Point Proximity ---
         for (let i = 0; i < normalPoints.length; i++) {
            const p = normalPoints[i];
            const dx = gx - p.x;
            const dy = gy - p.y;
            const d = Math.sqrt(dx * dx + dy * dy);

            if (d < influenceRadius) {
               // Linear falloff matrix: maximum weight at the center, fading out to 0 at the boundary limit
               nodeHeight += pointWeight * (1.0 - (d / influenceRadius));
            }
         }

         // --- Tier B: Accumulate High-Value Feature Landmark Proximity ---
         for (let i = 0; i < features.length; i++) {
            const f = features[i];
            const dx = gx - f.x;
            const dy = gy - f.y;
            const d = Math.sqrt(dx * dx + dy * dy);

            if (d < influenceRadius) {
               // Features stack the identical falloff trend, multiplied by the higher tier weight factor
               nodeHeight += featureWeight * (1.0 - (d / influenceRadius));
            }
         }

         // 4. Round values to 4 decimal points to avoid float noise and store in matrix grid cell
         heightmap[r][c] = Math.round(nodeHeight * 10000) / 10000;
      }
   }

   return heightmap;
}


function circleHell(context) {
   const heightmap = calculateKanjiHeightmap(referenceKanji, structuralData)

   // const thresholds = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19] 
   const thresholds = [2]
   const { ctx } = context;
   
   const gridRows = heightmap.length;
   const gridCols = heightmap[0].length;
   
   // Hardcoded target size matching your KanjiVG canvas boundaries
   const canvasScale = 109; 
   const stepX = canvasScale / (gridCols - 1);
   const stepY = canvasScale / (gridRows - 1);

   // ctx.save();

   // ctx.lineWidth = 1.2;
   // ctx.strokeStyle = "rgba(142, 142, 147, 0.6)"; // Muted gray topographical ink

   // // Helper function to linearly interpolate a coordinate between two grid nodes
   // function interpolate(v1, v2, t) {
   //    return v1 + t * (v2 - v1);
   // }

   // // 1. Loop through each elevation threshold layer (creates the concentric levels)
   // thresholds.forEach((isoLevel) => {
   //    ctx.beginPath();

   //    // 2. Scan every individual grid cell in the matrix
   //    for (let r = 0; r < gridRows - 1; r++) {
   //       for (let c = 0; c < gridCols - 1; c++) {
            
   //          // Map the coordinates and scalar heights of the 4 corners of the current cell square
   //          const x0 = c * stepX,     x1 = (c + 1) * stepX;
   //          const y0 = r * stepY,     y1 = (r + 1) * stepY;

   //          const hTL = heightmap[r][c];       // Top-Left
   //          const hTR = heightmap[r][c + 1];   // Top-Right
   //          const hBR = heightmap[r + 1][c + 1]; // Bottom-Right
   //          const hBL = heightmap[r + 1][c];   // Bottom-Left

   //          // 3. Check every edge of this square cell to see if the contour line passes through it
   //          const points = [];

   //          // Top Edge (TL -> TR)
   //          if ((hTL >= isoLevel && hTR < isoLevel) || (hTL < isoLevel && hTR >= isoLevel)) {
   //             let t = (isoLevel - hTL) / (hTR - hTL);
   //             points.push({ x: interpolate(x0, x1, t), y: y0 });
   //          }
   //          // Right Edge (TR -> BR)
   //          if ((hTR >= isoLevel && hBR < isoLevel) || (hTR < isoLevel && hBR >= isoLevel)) {
   //             let t = (isoLevel - hTR) / (hBR - hTR);
   //             points.push({ x: x1, y: interpolate(y0, y1, t) });
   //          }
   //          // Bottom Edge (BL -> BR)
   //          if ((hBL >= isoLevel && hBR < isoLevel) || (hBL < isoLevel && hBR >= isoLevel)) {
   //             let t = (isoLevel - hBL) / (hBR - hBL);
   //             points.push({ x: interpolate(x0, x1, t), y: y1 });
   //          }
   //          // Left Edge (TL -> BL)
   //          if ((hTL >= isoLevel && hBL < isoLevel) || (hTL < isoLevel && hBL >= isoLevel)) {
   //             let t = (isoLevel - hTL) / (hBL - hTL);
   //             points.push({ x: x0, y: interpolate(y0, y1, t) });
   //          }

   //          // 4. If the threshold crosses this cell, connect the interception points
   //          if (points.length >= 2) {
   //             // Apply your canvas UI scaling function if necessary
   //             const pA = typeof scaleReferencePoint === 'function' ? scaleReferencePoint(context, points[0]) : points[0];
   //             const pB = typeof scaleReferencePoint === 'function' ? scaleReferencePoint(context, points[1]) : points[1];
               
   //             ctx.moveTo(pA.x, pA.y);
   //             ctx.lineTo(pB.x, pB.y);

   //             // Handle rare ambiguous saddle cases (where 4 intersections occur in one cell)
   //             if (points.length === 4) {
   //                const pC = typeof scaleReferencePoint === 'function' ? scaleReferencePoint(context, points[2]) : points[2];
   //                const pD = typeof scaleReferencePoint === 'function' ? scaleReferencePoint(context, points[3]) : points[3];
   //                ctx.moveTo(pC.x, pC.y);
   //                ctx.lineTo(pD.x, pD.y);
   //             }
   //          }
   //       }
   //    }
   //    ctx.stroke();
   // });

   // ctx.restore();

   ctx.save();

// --- Simplified Configuration Parameters ---
const maxRadius = 6;                  // Single knob controlling grid spacing
const gridSpacing = maxRadius * 2;    // Center-to-center distance (Diameter)
const capRadius = gridSpacing * 0.42; // 90% of the maximum allowed radius (prevents touching)
const minAllowedRadius = 2;         // Prevents rendering sub-pixel artifacts

ctx.fillStyle = "#FFFFFF"; 
ctx.strokeStyle = "rgba(142, 142, 147, 0.7)";
ctx.lineWidth = 0.8;

// Helper: Bilinear interpolation to sample height values
function sampleHeightmap(x, y) {
   const c = x / stepX;
   const r = y / stepY;
   
   const c0 = Math.max(0, Math.min(gridCols - 2, Math.floor(c)));
   const c1 = c0 + 1;
   const r0 = Math.max(0, Math.min(gridRows - 2, Math.floor(r)));
   const r1 = r0 + 1;
   
   const tx = c - c0;
   const ty = r - r0;
   
   const h00 = heightmap[r0][c0];
   const h10 = heightmap[r0][c1];
   const h01 = heightmap[r1][c0];
   const h11 = heightmap[r1][c1];
   
   const top = h00 + tx * (h10 - h00);
   const bottom = h01 + tx * (h11 - h01);
   return top + ty * (bottom - top);
}

// Helper: Find shortest distance from a point to a line segment
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
   const dx = x2 - x1;
   const dy = y2 - y1;
   if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
   
   let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
   t = Math.max(0, Math.min(1, t)); 
   
   return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function interpolate(v1, v2, t) {
   return v1 + t * (v2 - v1);
}

thresholds.forEach((isoLevel) => {
   const segments = [];

   // 1. Extract explicit line segments using Marching Squares (Stored in base unscaled space)
   for (let r = 0; r < gridRows - 1; r++) {
      for (let c = 0; c < gridCols - 1; c++) {
         const x0 = c * stepX,     x1 = (c + 1) * stepX;
         const y0 = r * stepY,     y1 = (r + 1) * stepY;

         const hTL = heightmap[r][c];
         const hTR = heightmap[r][c + 1];
         const hBR = heightmap[r + 1][c + 1];
         const hBL = heightmap[r + 1][c];

         const points = [];

         if ((hTL >= isoLevel && hTR < isoLevel) || (hTL < isoLevel && hTR >= isoLevel)) {
            points.push({ x: interpolate(x0, x1, (isoLevel - hTL) / (hTR - hTL)), y: y0 });
         }
         if ((hTR >= isoLevel && hBR < isoLevel) || (hTR < isoLevel && hBR >= isoLevel)) {
            points.push({ x: x1, y: interpolate(y0, y1, (isoLevel - hTR) / (hBR - hTR)) });
         }
         if ((hBL >= isoLevel && hBR < isoLevel) || (hBL < isoLevel && hBR >= isoLevel)) {
            points.push({ x: interpolate(x0, x1, (isoLevel - hBL) / (hBR - hBL)), y: y1 });
         }
         if ((hTL >= isoLevel && hBL < isoLevel) || (hTL < isoLevel && hBL >= isoLevel)) {
            points.push({ x: x0, y: interpolate(y0, y1, (isoLevel - hTL) / (hBL - hTL)) });
         }

         if (points.length >= 2) {
            segments.push({ p1: points[0], p2: points[1] });
            if (points.length === 4) {
               segments.push({ p1: points[2], p2: points[3] });
            }
         }
      }
   }

   // 2. Generate triangular circle grid starting strictly at 0,0
   const rowHeight = gridSpacing * Math.sqrt(3) / 2;
   
   for (let y = 0; y <= canvasScale; y += rowHeight) {
      // Calculate row index to stagger every odd row
      const rowIndex = Math.round(y / rowHeight);
      const isOddRow = rowIndex % 2 !== 0;
      
      // Stagger odd rows by half the spacing, keeping row 0 starting exactly at x=0
      const startX = isOddRow ? gridSpacing / 2 : 0;

      for (let x = startX; x <= canvasScale; x += gridSpacing) {
         
         // Only draw inside the safe field bounding box boundaries
         if (x < 0 || x > canvasScale || y < 0 || y > canvasScale) continue;

         const localHeight = sampleHeightmap(x, y);
         if (localHeight >= isoLevel) continue;

         // 3. Proximity check done entirely in the SAME base map coordinate space
         let minDistance = Infinity;
         segments.forEach(seg => {
            const dist = pointToSegmentDistance(x, y, seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y);
            if (dist < minDistance) {
               minDistance = dist;
            }
         });

         // Max target size starts at our 90% cap limit
         let targetRadius = capRadius;

         // Shrink if it gets too close to the isoline boundary
         const spacingBuffer = gridSpacing * 0.05; // 10% total padding (5% on each side of the gap)
         if (minDistance < targetRadius + spacingBuffer) {
            targetRadius = minDistance - spacingBuffer;
         }

         // 4. Transform positions and radii to UI canvas scale space at the exact moment of drawing
         if (targetRadius >= minAllowedRadius) {
            let renderPos = { x, y };
            let edgePos = { x: x + targetRadius, y }; // Use a sample point to calculate scaled radius factor

            if (typeof scaleReferencePoint === 'function') {
               renderPos = scaleReferencePoint(context, renderPos);
               edgePos = scaleReferencePoint(context, edgePos);
            }

            // Calculate the actual scaled radius dynamically based on the current context scale matrix
            const scaledRadius = Math.abs(edgePos.x - renderPos.x);

            ctx.beginPath();
            ctx.arc(renderPos.x, renderPos.y, scaledRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
         }
      }
   }
});


   ctx.restore();

   const radius = 4;

   // referenceKanji.forEach((stroke, idx) => {
   //    const p0 = scaleReferencePoint(context, stroke[0]);
   //    const p9 = scaleReferencePoint(context, stroke.at(-1));

   //    ctx.save();
      
   //    ctx.beginPath();
   //    ctx.fillStyle = '#8e8e93';
   //    ctx.arc(p0.x, p0.y, radius, 0, 2 * Math.PI);
   //    ctx.arc(p9.x, p9.y, radius, 0, 2 * Math.PI);
   //    ctx.fill();

   //    ctx.restore();
   // });

   structuralData.forEach((hint) => {
      const { t, x, y } = hint;

      // Handle coordinate space scaling transformation if present
      const renderX = typeof scaleReferencePoint === 'function' ? scaleReferencePoint(context, { x, y }).x : x;
      const renderY = typeof scaleReferencePoint === 'function' ? scaleReferencePoint(context, { x, y }).y : y;

      ctx.save();
      
      if (t === 'joint') { // '#8e8e93'
         ctx.fillStyle = '#007aff'; //'#ff3b30';
      } else if (t === 'angle') {
         ctx.fillStyle = '#007aff'; //'#007aff';
      } else if (t === 'floater') {
         ctx.fillStyle = 'transparent';
      }

      if (t != 'floater') {
         ctx.beginPath();
         ctx.arc(renderX, renderY, radius, 0, 2 * Math.PI);
         ctx.fill();
      }

      ctx.restore();
   });
}



// function parseComponentGridAreas(context, options = {}) {
//    // const strokes = referenceKanji.map(stroke => 
//    //    stroke.map(point => scaleReferencePoint(context, point))
//    // )

//    const strokes = referenceKanji;

//    const gridRows = options.gridRows || 9;
//    const gridCols = options.gridCols || 9;
//    const connectionRadius = options.connectionRadius || 4.0;
//    const canvasScale = options.canvasScale || 109.0; // Native KanjiVG resolution

//    const totalStrokes = strokes.length;
//    const dist = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

//    // --- STEP 1: Find interconnected pieces ---
//    const adjacency = Array.from({ length: totalStrokes }, () => []);
//    for (let i = 0; i < totalStrokes; i++) {
//       for (let j = i + 1; j < totalStrokes; j++) {
//          let connected = false;
//          for (let p1 = 0; p1 < strokes[i].length; p1++) {
//             if (connected) break;
//             for (let p2 = 0; p2 < strokes[j].length; p2++) {
//                if (dist(strokes[i][p1], strokes[j][p2]) <= connectionRadius) {
//                   connected = true;
//                   break;
//                }
//             }
//          }
//          if (connected) {
//             adjacency[i].push(j);
//             adjacency[j].push(i);
//          }
//       }
//    }

//    // BFS to isolate distinct connected components
//    const visited = new Array(totalStrokes).fill(false);
//    const components = [];
//    for (let i = 0; i < totalStrokes; i++) {
//       if (!visited[i]) {
//          const group = [];
//          const queue = [i];
//          visited[i] = true;
//          while (queue.length > 0) {
//             const curr = queue.shift();
//             group.push(curr);
//             adjacency[curr].forEach((neighbor) => {
//                if (!visited[neighbor]) {
//                   visited[neighbor] = true;
//                   queue.push(neighbor);
//                }
//             });
//          }
//          components.push(group);
//       }
//    }

//    // --- STEP 2: Initialize the layout grid matrix ---
//    const gridLayout = Array.from({ length: gridRows }, () => new Array(gridCols).fill('empty'));
   
//    const cellW = canvasScale / gridCols;
//    const cellH = canvasScale / gridRows;

//    // --- STEP 3: Map components to grid areas ---
//    components.forEach((strokeIndices, compId) => {
//       strokeIndices.forEach((sIdx) => {
//          strokes[sIdx].forEach((pt) => {
//             // Locate grid cell row/col based on the point coordinates
//             const col = Math.min(Math.floor(pt.x / cellW), gridCols - 1);
//             const row = Math.min(Math.floor(pt.y / cellH), gridRows - 1);
            
//             // Assign the unique component integer identifier to the active zone cell
//             gridLayout[row][col] = compId;
//          });
//       });
//    });

//    return gridLayout;
// }


// function circleHell(context) {
//    const { ctx, canvas } = context;
//    const gridLayout = parseComponentGridAreas(context)

//    const gridRows = gridLayout.length;
//    const gridCols = gridLayout[0].length; // Safe columns check

//    // Calculate dimensions based on the canvas size
//    const cellWidth = canvas.width / gridCols;
//    const cellHeight = canvas.height / gridRows;

//    for (let r = 0; r < gridRows; r++) {
//       for (let c = 0; c < gridCols; c++) {
//          const currentCell = gridLayout[r][c];

//          const x = c * cellWidth;
//          const y = r * cellHeight;

//          ctx.save();

//          if (currentCell === 'empty') {
//             // --- DRAW EMPTY AREAS ---
//             // Fill unassigned space completely solid gray
//             ctx.fillStyle = 'rgba(0, 0, 0, 0.1)'; 
//             ctx.fillRect(x, y, cellWidth, cellHeight);
            
//          } else {
//             // --- DRAW UNIFIED OCCUPIED AREAS ---
//             // Leave interior transparent, but draw outer borders around the grouped area
//             ctx.strokeStyle = '#48484a'; // Thick outline for the area
//             ctx.lineWidth = 1;
//             ctx.lineCap = 'round';

//             // Check Top Edge: Draw line if at canvas top OR if neighbor above is different
//             if (r === 0 || gridLayout[r - 1][c] !== currentCell) {
//                ctx.beginPath();
//                ctx.moveTo(x, y);
//                ctx.lineTo(x + cellWidth, y);
//                ctx.stroke();
//             }

//             // Check Bottom Edge: Draw line if at canvas bottom OR if neighbor below is different
//             if (r === gridRows - 1 || gridLayout[r + 1][c] !== currentCell) {
//                ctx.beginPath();
//                ctx.moveTo(x, y + cellHeight);
//                ctx.lineTo(x + cellWidth, y + cellHeight);
//                ctx.stroke();
//             }

//             // Check Left Edge: Draw line if at canvas left OR if neighbor to the left is different
//             if (c === 0 || gridLayout[r][c - 1] !== currentCell) {
//                ctx.beginPath();
//                ctx.moveTo(x, y);
//                ctx.lineTo(x, y + cellHeight);
//                ctx.stroke();
//             }

//             // Check Right Edge: Draw line if at canvas right OR if neighbor to the right is different
//             if (c === gridCols - 1 || gridLayout[r][c + 1] !== currentCell) {
//                ctx.beginPath();
//                ctx.moveTo(x + cellWidth, y);
//                ctx.lineTo(x + cellWidth, y + cellHeight);
//                ctx.stroke();
//             }
//          }

//          ctx.restore();
//       }
//    }
// }

// function sampleCircles(context) {
//    const { canvas } = context;
//    const strokes = referenceKanji;
//    const gridSize = 9; 

//    const now = new Date();
//    const nextRandom = splitmix32(now.getHours() + now.getDate());

//    // --- TUNABLE SCRAMBLING ---
//    const scrambleRadius = 3; 

//    // 1. Combine and scale both data sources
//    let allPoints = [
//       ...strokes.flat(),
//       ...structuralData
//    ].map(point => scaleReferencePoint(context, point));
   
//    // 2. Apply the tunable scrambling offset to each point
//    if (scrambleRadius > 0) {
//       allPoints = allPoints.map(point => {
//          const angle = nextRandom() * Math.PI * 2;
//          const distance = Math.sqrt(nextRandom()) * scrambleRadius; 
         
//          return {
//             x: point.x + Math.cos(angle) * distance,
//             y: point.y + Math.sin(angle) * distance
//          };
//       });
//    }
   
//    const xSpacing = canvas.width / gridSize;
//    const ySpacing = xSpacing * (Math.sqrt(3) / 2); 
   
//    const maxRadius = xSpacing / 2;
//    const minRadius = 0; 
//    const availableRadiusRange = maxRadius - minRadius;
   
//    const maxInfluenceDistance = xSpacing * 1; 
//    // Pre-calculate squared distance to avoid expensive Math.sqrt calls inside the loop
//    const maxInfluenceDistanceSq = maxInfluenceDistance * maxInfluenceDistance;
   
//    const circleData = [];
//    const totalRows = Math.ceil(canvas.height / ySpacing);

//    for (let r = 0; r <= totalRows; r++) {
//       const y = r * r * 0 === 0 ? r * ySpacing : 0; 
//       const xOffset = (r % 2 === 1) ? xSpacing / 2 : 0;
      
//       for (let c = 0; c <= gridSize; c++) {
//          const x = c * xSpacing + xOffset;
         
//          // --- DENSITY COUNTING LOGIC ---
//          let pointsInInfluence = 0;
         
//          for (let i = 0; i < allPoints.length; i++) {
//             const px = allPoints[i].x - x;
//             const py = allPoints[i].y - y;
//             const distSq = px * px + py * py;
            
//             // Count how many points fall inside the influence radius
//             if (distSq < maxInfluenceDistanceSq) {
//                pointsInInfluence++;
//             }
//          }
         
//          // --- INVERTED RADIUS LOGIC BASED ON COUNT ---
//          // Tune this number based on your dataset size. 
//          // If a dense spot has 20 points, setting this to 20 means 20+ points will result in minRadius.
//          const maxExpectedPoints = 15; 
         
//          // Normalize the density count between 0.0 and 1.0 (clamped at 1.0)
//          const densityRatio = Math.min(pointsInInfluence / maxExpectedPoints, 1.0);
         
//          // Invert it: high density (ratio near 1) -> small radius. Low density (ratio 0) -> big radius.
//          const radius = minRadius + (availableRadiusRange * (1 - densityRatio));
         
//          circleData.push({ x, y, radius });
//       }
//    }

//    return circleData;
// }



// function circleHell(context) {
//    const { ctx, canvas } = context;
   
//    const circleData = sampleCircles(context);
//    ctx.save();

//    ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
//    ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
   
//    for (let i = 0; i < circleData.length; i++) {
//       const circle = circleData[i];
      
//       ctx.beginPath();
//       ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
//       ctx.lineWidth = 1;
//       ctx.fill();
//       // ctx.stroke();
//    }

//    ctx.restore()
// }



// function computeQuadtreeNegative(context) {
//    const { canvas } = context;
//    const strokes = referenceKanji;

//    // 1. Combine and scale data sources (identical to your original setup)
//    const allPoints = [
//       ...strokes.flat(),
//       ...structuralData
//    ].map(point => scaleReferencePoint(context, point));

//    const leaves = [];
   
//    // Min size prevents infinite loops and controls the "resolution" of the negative silhouette
//    // 4 to 8 pixels usually creates a beautifully sharp digital edge
//    const minBlockSize = 32; 

//    // Recursive helper function to check and split space
//    function subdivide(x, y, size) {
//       // Count how many points fall inside this specific bounding box
//       let pointCount = 0;
//       for (let i = 0; i < allPoints.length; i++) {
//          const p = allPoints[i];
//          if (p.x >= x && p.x < x + size && p.y >= y && p.y < y + size) {
//             pointCount++;
//          }
//       }

//       // If it contains points AND can still be split, subdivide it into 4 quadrants
//       if (pointCount > 0 && size > minBlockSize) {
//          const half = size / 2;
//          subdivide(x, y, half);        // Top-Left
//          subdivide(x + half, y, half);   // Top-Right
//          subdivide(x, y + half, half);   // Bottom-Left
//          subdivide(x + half, y + half, half); // Bottom-Right
//       } else if (pointCount === 0) {
//          // NEGATIVE SPACE CAPTURE: Only save blocks that contain absolutely NO points
//          leaves.push({ x, y, size });
//       }
//    }

//    // Start the recursion from a square matching the largest dimension of your canvas
//    const baseSize = Math.max(canvas.width, canvas.height);
//    subdivide(0, 0, baseSize);

//    return leaves;
// }

// function circleHell(context) {
//    const { ctx } = context;
//    const quadtreeBlocks = computeQuadtreeNegative(context)


//    // Draw each negative space block
//    for (let i = 0; i < quadtreeBlocks.length; i++) {
//       const block = quadtreeBlocks[i];

//       // Subtle padding turns the blocks into an intricate grid matrix
//       const padding = 1;
//       const renderX = block.x + padding;
//       const renderY = block.y + padding;
//       const renderSize = block.size - (padding * 2);

//       if (renderSize <= 0) continue;

//       // // Style the blocks (e.g., glowing white/gray blocks against the dark background)
//       ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
//       ctx.fillRect(renderX, renderY, renderSize, renderSize);

//       // Optional: Add a subtle border to make the structural fragmentation pop
//       ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
//       ctx.lineWidth = 1;
//       ctx.strokeRect(renderX, renderY, renderSize, renderSize);
//    }
// }
