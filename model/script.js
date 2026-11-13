const pointMath = {

   getDistance (p1, p2) {
      return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
   },

   scalePoint (p0, mode) {
      if (mode == 'input') {
         return { x: p0.x / ENV.scale, y: p0.y / ENV.scale }
      } else {
         return { x: p0.x * ENV.scale, y: p0.y * ENV.scale }
      }
   },

   scaleStroke (s0, mode) {
      return s0.map(point => pointMath.scalePoint(point, mode));
   },

   decimateStroke(s0) {
      const len = s0.length;
      if (len < 2) return s0;

      const filteredPoints = [s0[0]];
      let lastSaved = s0[0];
      const distanceThresholdSq = 3 ** 2;

      for (let i = 1; i < len; i++) {
         const p1 = s0[i];
         const dx = p1.x - lastSaved.x;
         const dy = p1.y - lastSaved.y;
         
         if (dx * dx + dy * dy >= distanceThresholdSq || i === len - 1) {
            filteredPoints.push(p1);
            lastSaved = p1;
         }
      }

      return filteredPoints;
   },

   // remove timestamps from this and everywhere else

   smoothStroke(s0) {
      const len = s0.length;
      if (len < 2) return s0;
      
      let result = pointMath.decimateStroke(s0);
      
      // Chaikin's Smoothing
      for (let p = 0; p < CONFIG.stroke_smoothing_passes; p++) {
         const rLen = result.length;
         if (rLen < 3) break;
         
         const nextPass = new Array((rLen - 2) * 2 + 2); 
         nextPass[0] = result[0];
         
         let index = 1;
         for (let i = 0; i < rLen - 1; i++) {
            const p0 = result[i];
            const p1 = result[i + 1];
            
            nextPass[index++] = {
               x: p0.x * 0.75 + p1.x * 0.25,
               y: p0.y * 0.75 + p1.y * 0.25
            };
            
            nextPass[index++] = {
               x: p0.x * 0.25 + p1.x * 0.75,
               y: p0.y * 0.25 + p1.y * 0.75
            };
         }

         nextPass[index] = result[rLen - 1];
         result = nextPass;
      }
      
      return result;
   }

}


const validationUtils = {

   resampleStroke (s0, pointCount) {
      if (s0.length < 2 || pointCount < 2) return s0;

      // Step A: Calculate total length and segments
      let totalLength = 0;
      const segments = [];
      for (let i = 0; i < s0.length - 1; i++) {
         const dist = pointMath.getDistance(s0[i], s0[i + 1]);
         totalLength += dist;
         segments.push({ start: s0[i], end: s0[i + 1], length: dist, cumulative: totalLength });
      }

      // Handle edge case where user clicks down and doesn't move
      if (totalLength === 0) {
         return Array(pointCount).fill(null).map(() => ({ x: s0[0].x, y: s0[0].y }));
      }

      // Step B: Crawl along the path collecting evenly spaced points
      const interval = totalLength / (pointCount - 1);
      const resampledPoints = [s0[0]]; // Always include exact start point

      let currentSegmentIdx = 0;

      for (let i = 1; i < pointCount - 1; i++) {
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

      resampledPoints.push(s0[s0.length - 1]); // Always include exact end point
      return resampledPoints;
   },

   gradeStrokeDirection(input, target) {
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
   },

   gradeStrokeLength(input, target) {
      // returns %, deviation by maxDeviationFactor results in 0
      const maxDeviationFactor = 6; 

      let inputLength = 0;
      for (let k = 0; k < input.length - 1; k++) {
         inputLength += pointMath.getDistance(input[k], input[k + 1]);
      }

      let targetLength = 0;
      for (let k = 0; k < target.length - 1; k++) {
         targetLength += pointMath.getDistance(target[k], target[k + 1]);
      }

      const maxLen = Math.max(inputLength, targetLength);
      const minLen = Math.min(inputLength, targetLength);
      const ratio = maxLen / minLen;
      const alignment = 1 - (ratio - 1) / (maxDeviationFactor - 1);

      return Math.max(0, alignment) * 100;
   },

   gradeStrokeShape(input, target) {
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
   },

   gradeStroke(idx) {
      if (idx >= referenceKanji.length) return 0;
      const referenceStroke = referenceKanji[idx];

      const stroke = window.yuzutan.strokes[idx];
      const scaledStroke = pointMath.scaleStroke(stroke, 'input');
      const resampledStroke = validationUtils.resampleStroke(scaledStroke, referenceStroke.length);

      const directionScore = validationUtils.gradeStrokeDirection(resampledStroke, referenceStroke);
      const lengthScore = validationUtils.gradeStrokeLength(resampledStroke, referenceStroke);
      const shapeScore = validationUtils.gradeStrokeShape(resampledStroke, referenceStroke);

      return Math.min(directionScore, lengthScore, shapeScore);
   }
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


const canvasUtils = {

   initCanvas (id) {
      let canvas = document.getElementById(id);
      if (!canvas) return;
      
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      ctx.lineWidth = CONFIG.stroke_line_width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";  
      
      return { canvas, ctx, rect };
   },

   getColor (idx) {
      if (CONFIG.stroke_order_gradient == 'mono') {
         const progress = idx / (referenceKanji.length - 1);
         const lightness = 0.85 - (progress * 0.70); 
         return !ENV.isDarkMode ? `oklch(${lightness} 0.0 250)` : `oklch(${1-lightness} 0.0 250)`;
      } else {
         const hue = ((idx / referenceKanji.length) + 0.08) * 320;
         return !ENV.isDarkMode ? `oklch(0.69 0.20 ${hue})` : `oklch(0.85 0.25 ${hue})`;
      }
   },

   getValidatedColor (score, idx) {
      const color = canvasUtils.getColor(idx);
      if (score >= 80) return color;

      const badColour = CONFIG.stroke_order_gradient === 'mono' 
         ? 'oklch(62.8% 0.2577 29.23)' 
         : ENV.strokeColor;

      const reductionPercent = Math.min((100 - score) * 1.5, 100);
      return `color-mix(in oklch, ${color}, ${badColour} ${reductionPercent}%)`;
   },

   // renderStroke(ctx, stroke) {
   //    if (stroke.length < 2) return;

   //    ctx.beginPath();
   //    ctx.moveTo(stroke[0].x, stroke[0].y);
   //    for (let i = 1; i < stroke.length; i++) {
   //       ctx.lineTo(stroke[i].x, stroke[i].y);
   //    }
   //    ctx.stroke(); 
   // }

   renderStroke(ctx, stroke) {
      const len = stroke.length;
      if (len < 2) return;

      const MAX_WIDTH = ctx.lineWidth;
      const MIN_WIDTH = MAX_WIDTH * 0.8;
      const START_TAPER_PX = CONFIG.stroke_line_width * 1;
      const END_TAPER_PX = CONFIG.stroke_line_width * 2;

      // 1. Pure floating array map (faster allocation than full array object instantiations)
      const widths = [];
      widths.length = len;
      widths[0] = MIN_WIDTH;
      widths[len - 1] = MIN_WIDTH;

      // 2. Pass 1: Walk forward for the start taper
      let accumStartDist = 0;
      let i = 1;
      const startBound = len - 1;
      
      for (; i < startBound; i++) {
         const pCurrent = stroke[i];
         const pPrev = stroke[i - 1];
         accumStartDist += Math.hypot(pCurrent.x - pPrev.x, pCurrent.y - pPrev.y);
         
         if (accumStartDist >= START_TAPER_PX) break;
         widths[i] = MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * (accumStartDist / START_TAPER_PX);
      }

      // Fast-fill the remaining middle space forwards up to the tail block
      const midFillEnd = len - 1;
      for (; i < midFillEnd; i++) {
         widths[i] = MAX_WIDTH;
      }

      // 3. Pass 2: Walk backward for the live end taper
      let accumEndDist = 0;
      for (let j = len - 2; j > 0; j--) {
         const pCurrent = stroke[j];
         const pNext = stroke[j + 1];
         accumEndDist += Math.hypot(pCurrent.x - pNext.x, pCurrent.y - pNext.y);
         
         if (accumEndDist >= END_TAPER_PX) break;
         
         const endWidth = MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * (accumEndDist / END_TAPER_PX);
         // Keep thinner target if the stroke is tiny and tapers crash into each other
         if (endWidth < widths[j]) {
            widths[j] = endWidth;
         }
      }

      ctx.save();

      // 4. Render Phase via Quadratic Curves
      if (len === 2) {
         const p0 = stroke[0];
         const p1 = stroke[1];
         ctx.beginPath();
         ctx.lineWidth = widths[0];
         ctx.moveTo(p0.x, p0.y);
         ctx.lineTo(p1.x, p1.y);
         ctx.stroke();
         return;
      }

      // First Line segment
      const p0_init = stroke[0];
      const p1_init = stroke[1];
      ctx.beginPath();
      ctx.lineWidth = widths[0];
      ctx.moveTo(p0_init.x, p0_init.y);
      ctx.lineTo((p0_init.x + p1_init.x) * 0.5, (p0_init.y + p1_init.y) * 0.5);
      ctx.stroke();

      // Main Body Curves Loop
      const renderBound = len - 1;
      for (let k = 1; k < renderBound; k++) {
         const p0 = stroke[k - 1];
         const p1 = stroke[k];
         const p2 = stroke[k + 1];

         ctx.beginPath();
         ctx.lineWidth = widths[k];
         ctx.moveTo((p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5);
         ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.49999); // bitwise trick avoid float overhead
         ctx.stroke();
      }

      // Final Line segment
      const pSecondToLast = stroke[len - 2];
      const pLast = stroke[len - 1];
      ctx.beginPath();
      ctx.lineWidth = widths[len - 1];
      ctx.moveTo((pSecondToLast.x + pLast.x) * 0.5, (pSecondToLast.y + pLast.y) * 0.5);
      ctx.lineTo(pLast.x, pLast.y);
      ctx.stroke();

      ctx.restore();
   },

   renderColorStroke(ctx, stroke) {
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
      ctx.strokeStyle = !ENV.isDarkMode
         ? "rgba(255, 255, 255, 0.8)"
         : "rgba(0, 0, 0, 0.8)"
      canvasUtils.renderStroke(ctx, stroke);

      // line itself
      ctx.lineWidth = originalWidth;
      ctx.strokeStyle = originalColor;
      canvasUtils.renderStroke(ctx, stroke);

      ctx.restore();
   },

   renderStrokePoint(ctx, p0) {
      const radius = CONFIG.stroke_line_width * 0.5;
      const coreColor = ctx.strokeStyle;

      ctx.save(); 

      ctx.beginPath();
      ctx.arc(p0.x, p0.y, radius + 1, 0, Math.PI * 2);
      ctx.fillStyle = !ENV.isDarkMode
         ? "rgba(255, 255, 255, 0.8)"
         : "rgba(0, 0, 0, 0.8)"
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p0.x, p0.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = coreColor; 
      ctx.fill(); 

      ctx.restore();  
   }
}



// canvases

function initReferenceCanvas(id) {
   const context = canvasUtils.initCanvas(id);
   if (!context) return;

   const { canvas, ctx, rect } = context;

   let doShowDiagram = !ENV.isFront;
   let isSticky = false;

   function clear() {
      ctx.clearRect(0, 0, rect.width, rect.height);
      // drawCanvasElement = document.getElementById('drawCanvas');
      // if (drawCanvasElement) drawCanvasElement.classList.remove("dimmedCanvas");
      const canvasContainer = document.getElementById('referenceCanvasContainer');
      if (canvasContainer) canvasContainer.style.backdropFilter = 'blur(0px)';
   }

   EVENT.on('ref:render', render);
   function render() {
      clear();

      if (ENV.isFront) {
         renderNoiseHints(ctx);

         if (CONFIG.hint_first_stroke_start && window.yuzutan.strokes.length == 0) {
            ctx.strokeStyle = canvasUtils.getColor(0);
            const firstStrokeStartPoint = pointMath.scalePoint(referenceKanji[0][0]);
            canvasUtils.renderStrokePoint(ctx, firstStrokeStartPoint);
         }
      }
      
      if (doShowDiagram || isSticky) {
         const canvasContainer = document.getElementById('referenceCanvasContainer');
         if (canvasContainer) canvasContainer.style.backdropFilter = 'blur(4px)';
         
         referenceKanji.forEach((stroke, idx) => { 
            ctx.strokeStyle = canvasUtils.getColor(idx);
            const scaledStroke = pointMath.scaleStroke(stroke);
            canvasUtils.renderColorStroke(ctx, scaledStroke);
            canvasUtils.renderStrokePoint(ctx, scaledStroke[0]);
         });
      }

   }

   EVENT.on('drw:addstroke', hide)
   EVENT.on('drw:remstroke', hide)
   function hide() {
      doShowDiagram = false;
      render();
   }

   EVENT.on('ref:toggle', toggle)
   function toggle() {
      doShowDiagram = !doShowDiagram;
      render();
      window.yuzutan.hasShownDiagram = true;
   }

   EVENT.on('ref:sticky', () => {
      doShowDiagram = isSticky ? false : !doShowDiagram;
      isSticky = !isSticky;
      render();
      window.yuzutan.hasShownDiagram = true;
   });

   render();
   return context;
}


function initDrawingCanvas(id) {
   const context = canvasUtils.initCanvas(id);
   if (!context) return;

   const { canvas, ctx, rect } = context;
   const strokeColor = ENV.strokeColor;
   
   ENV.isPenDown = false;
   let currentStroke = [];

   function getPos(e) {
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
   }

   function render() {
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = CONFIG.stroke_line_width;
      
      window.yuzutan.strokes.forEach((stroke) => {
         canvasUtils.renderStroke(ctx, stroke)
      });  
   }

   render();

   EVENT.on('drw:undo', undo)
   function undo() {
      window.yuzutan.strokes.pop();
      EVENT.emit('drw:remstroke');
      render();
   }

   EVENT.on('drw:clear', clear)
   function clear() {
      window.yuzutan.strokes.length = 0;
      EVENT.emit('drw:remstroke');
      render();
   }

   canvas.addEventListener("pointerdown", (e) => {
      ENV.isPenDown = true;
      const startPos = getPos(e);
      currentStroke = [startPos];
      ctx.beginPath();
      ctx.moveTo(startPos.x, startPos.y);
   });

   canvas.addEventListener("pointermove", (e) => {
      if (!ENV.isPenDown) return;
      const point = getPos(e);
      const assisted_point = applyAimAssist(point);
      currentStroke.push(assisted_point);
      eraseNoiseNearPen(point);
      render();
      const smoothedStroke = pointMath.smoothStroke(currentStroke);
      canvasUtils.renderStroke(ctx, smoothedStroke);
   });

   window.addEventListener("pointerup", () => {
      if (!ENV.isPenDown) return;
      ENV.isPenDown = false;
      const smoothedStroke = pointMath.smoothStroke(currentStroke);
      if (smoothedStroke.length > 2) {
         window.yuzutan.strokes.push(smoothedStroke);
         EVENT.emit('drw:addstroke');
      }
      render();
   });

   EVENT.emit('drw:addstroke');
}


function initResultCanvas(id) {
   const context = canvasUtils.initCanvas(id);
   if (!context) return;

   const { canvas, ctx, rect } = context;

   function render() {
      ctx.clearRect(0, 0, rect.width, rect.height);

      window.yuzutan.strokes.forEach((stroke, idx) => {
         const score = validationUtils.gradeStroke(idx);
         ctx.strokeStyle = canvasUtils.getValidatedColor(score, idx);
         canvasUtils.renderColorStroke(ctx, stroke);
         canvasUtils.renderStrokePoint(ctx, stroke[0]);
      });

      displayScore();
   }

   function calcScore() {
      if (window.yuzutan.strokes.length != referenceKanji.length) return 0;

      let endScore = 0;
      window.yuzutan.strokes.forEach((stroke, idx) => {
         endScore += validationUtils.gradeStroke(idx);
      });
      
      return Math.round(endScore / referenceKanji.length); 
   }

   function displayScore() {
      let score = calcScore();

      let scoreBox = document.getElementById('kanjiScoreBox');

      let color = "#e74c3c";
      if (score >= 90) color = "#2ecc71";
      else if (score >= 60) color = "#f39c12";

      let diagramIcon = window.yuzutan.hasShownDiagram ? '🧭' : '';
      let hintIcon = '';
      let noiseIndicator = ''
      if (window.yuzutan.visibleNoisePercent > 0) {
         noiseIndicator = Math.round(Math.pow(window.yuzutan.visibleNoisePercent, 1.5) * 100); // note: this has to match the rendering function
         hintIcon = '💡';
      }

      scoreBox.innerHTML = `<span style="color:${color};font-weight:bold;">${score}</span> スコア ${hintIcon} <span style="font-weight:bold;">${noiseIndicator}</span> ${diagramIcon}`;
   }

   render();
}


// our teeny tiny event bus to wire stuff up

const EVENT = {
   listeners: {},
   on(event, fn) { (this.listeners[event] ||= []).push(fn); },
   emit(event, data) { (this.listeners[event] || []).forEach(fn => fn(data)); }
};


// init


const referenceKanji = (new Function(`return (${`{{ReferenceData}}`})`))();
const structuralData = (new Function(`return (${`{{StructuralData}}`})`))();
const componentBreakdown = (new Function(`return (${`{{Breakdown}}`})`))();

const _ref = canvasUtils.initCanvas('referenceCanvas');

const ENV = {
   isFront: document.querySelector('main').classList.contains('front'),
   isDarkMode: document.querySelector('body').classList.contains('nightMode'),
   scale: _ref.rect.width / 109,
}

if (ENV.isFront) {
   window.yuzutan = window.yuzutan || {};
   window.yuzutan.strokes = [];
   window.yuzutan.visibleNoisePercent = 0;
   window.yuzutan.hasShownDiagram = false;
} else {
   window.yuzutan.strokes = window.yuzutan.strokes || [];
}


ENV.allScheduledNoisePoints = [];
ENV.autoHintTimer = null;
ENV.cardStartTime = null;
ENV.recallLatencyMs = null;

ENV.strokeColor = ENV.isDarkMode ? "oklch(0.9 0 none)" : "oklch(0.15 0 none)";


initReferenceCanvas('referenceCanvas');
initDrawingCanvas('drawCanvas');
initResultCanvas('resultCanvas');


// botans c:

function initButton(buttonId, holdText, onShortPress, onLongPress) {
   const btn = document.getElementById(buttonId);
   const originalText = btn.textContent;
   const delay = 500;

   let timer = null;
   let isLongPress = false;

   const reset = () => {
      clearTimeout(timer);
      timer = null;
      if (holdText) btn.textContent = originalText;
   };

   btn.addEventListener("pointerdown", () => {
      isLongPress = false;
      if (holdText) btn.textContent = holdText;

      timer = setTimeout(() => {
         isLongPress = true;
         reset();
         if (onLongPress) onLongPress();
      }, delay);
   });

   btn.addEventListener("pointerup", () => {
      if (!timer && !isLongPress) return;
      reset();
      if (!isLongPress) onShortPress();
   });

   btn.addEventListener("pointerleave", reset);
   btn.addEventListener("pointercancel", reset);
}

if (ENV.isFront) {
   prepareAutoHintNoise();
   
   if (window.yuzutan.autoHint) {
      window.yuzutan.visibleNoisePercent = 0;
      startAutoHint();
      EVENT.emit('ref:render');
   }

   initButton(
      'undoBtn', '🧽',
      () => EVENT.emit('drw:undo'),
      () => EVENT.emit('drw:clear')
   )

   initButton(
      'diagramBtn', '📌',
      () => EVENT.emit('ref:toggle'),
      () => EVENT.emit('ref:sticky')
   )

   initButton(
      'hintBtn', '🌧️',
      () => {
         window.yuzutan.visibleNoisePercent = Math.min(1.0, window.yuzutan.visibleNoisePercent + CONFIG.hint_noise_manual_step);
         EVENT.emit('ref:render');
      },
      () => {
         if (!window.yuzutan.autoHint) {
            window.yuzutan.autoHint = true;
            startAutoHint();
            EVENT.emit('ref:render');
         } else {
            window.yuzutan.autoHint = false;         
         }
      }
   )
}




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
   if (!ENV.isFront) return sentence;
   
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

if (ENV.isFront) {
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



// noise stuff is going core, most flexible and universal hint style so far

function eraseNoiseNearPen(rawPenPos) {
   const points = ENV.allScheduledNoisePoints;
   if (!points) return;

   const penPos = pointMath.scalePoint(rawPenPos, 'input');
   const eraseRadiusSq = 6 * 6; // 9 units in 109x109 canvas space
   let changed = false;

   for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (pt.erased) continue;

      const dx = pt.x - penPos.x;
      const dy = pt.y - penPos.y;
      if (dx * dx + dy * dy <= eraseRadiusSq) {
         pt.erased = true;
         changed = true;
      }
   }

   if (changed) EVENT.emit('ref:render');
}


function renderNoiseHints(ctx) {
   const points = ENV.allScheduledNoisePoints;
   const rawPercent = window.yuzutan.visibleNoisePercent || 0;
   if (!points || points.length === 0 || rawPercent <= 0) return;

   const easePower = 1.5;
   const percent = Math.pow(rawPercent, easePower);

   const minAlpha = 0.50;
   const maxAlpha = 1.00;

   const minRadius = 2.0;
   const maxRadius = 3.0;
   
   const fadeWindow = Math.max(1, points.length * 0.03);
   const exactLimit = points.length * percent;
   const limit = Math.min(points.length, Math.ceil(exactLimit));

   ctx.save();
   ctx.fillStyle = ENV.strokeColor;

   for (let i = 0; i < limit; i++) {
      const pt = points[i];
      if (pt.erased) continue;
      const scaled = pointMath.scalePoint(pt);

      const fadeProgress = Math.min(1, Math.max(0, (exactLimit - i) / fadeWindow));
      const rHash = ((Math.sin(pt.x * 12.9898 + pt.y * 78.233 + i) * 43758.5453) % 1 + 1) % 1;
      const r = minRadius + rHash * (maxRadius - minRadius);

      const baseAlpha = minAlpha + pt.closeness * (maxAlpha - minAlpha);
      ctx.globalAlpha = baseAlpha * fadeProgress;
      ctx.beginPath();
      ctx.arc(scaled.x, scaled.y, r, 0, Math.PI * 2);
      ctx.fill();
   }

   ctx.restore();
}






function shuffleArray(arr) {
   for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
   }
   return arr;
}



function prepareAutoHintNoise() {
   const offsetRadius = 2.5;
   const uniformity = 0.7;
   const perStrokeBuckets = [];

   referenceKanji.forEach((stroke) => {
      const pool = stroke.map((_, i) => i);
      const strokeSpecks = [];

      while (pool.length > 0) {
         const uniformPos = Math.floor(pool.length / 2);
         // const uniformPos = 0;
         const randomPos = Math.floor(Math.random() * pool.length);
         const pickIdx = Math.max(0, Math.min(pool.length - 1, Math.round(randomPos * (1 - uniformity) + uniformPos * uniformity)));

         const basePt = stroke.at(pool.splice(pickIdx, 1).at(0));
         const angle = Math.random() * Math.PI * 2;
         const dist = Math.sqrt(Math.random()) * offsetRadius;

         strokeSpecks.push({
            x: basePt.x + Math.cos(angle) * dist,
            y: basePt.y + Math.sin(angle) * dist,
            closeness: 1 - (dist / offsetRadius)
         });
      }
      perStrokeBuckets.push(strokeSpecks);
   });

   ENV.allScheduledNoisePoints = [];
   const maxLen = Math.max(...perStrokeBuckets.map(b => b.length));
   for (let i = 0; i < maxLen; i++) {
      for (const bucket of perStrokeBuckets) {
         if (i < bucket.length) ENV.allScheduledNoisePoints.push(bucket[i]);
      }
   }

   shuffleArray(ENV.allScheduledNoisePoints);

   window.yuzutan.visibleNoisePercent = 0;
   ENV.recallLatencyMs = null;
}



function startAutoHint() {
   clearInterval(window._kanjiAutoHintTimer);

   const gracePeriodMs = CONFIG.hint_noise_auto_grace_period * 1000; // Initial wait before any dots appear on card load
   const strokePauseMs = CONFIG.hint_noise_auto_grace_period * 1000; // Wait time after lifting the pen before resuming dots
   const maxPercent = 1.0;    // Ceiling cap (stops early at 50%)
   const secondsToMax = CONFIG.hint_noise_auto_timeframe;    // Seconds it would take to reach 100% (1.0)
   const fps = 30;             // Updates per second

   const intervalMs = 1000 / fps;
   const stepPercent = 1.0 / (secondsToMax * fps);

   let idleMs = 0;
   let hasDrawnOnce = false;

   // Unique token for this specific card instance
   const runId = Symbol();
   window._kanjiAutoHintRunId = runId;

   window._kanjiAutoHintTimer = setInterval(() => {
      if (window._kanjiAutoHintRunId !== runId) {
         clearInterval(window._kanjiAutoHintTimer);
         return;
      }

      if (ENV.isPenDown) {
         hasDrawnOnce = true;
         idleMs = 0;
         return;
      }

      const requiredWaitMs = hasDrawnOnce ? strokePauseMs : gracePeriodMs;
      if (idleMs < requiredWaitMs) {
         idleMs += intervalMs;
         return;
      }

      if (window.yuzutan.visibleNoisePercent >= maxPercent) {
         clearInterval(window._kanjiAutoHintTimer);
         return;
      }

      window.yuzutan.visibleNoisePercent = Math.min(maxPercent, window.yuzutan.visibleNoisePercent + stepPercent);
      EVENT.emit('ref:render');
   }, intervalMs);
}














// this is a meme, but feels nice at low values on a bad tablet
// could experiment with offsetting the points if the stroke is too far away
// that would provide real time feedback

function applyAimAssist(rp) {

   if (!CONFIG._experimental) return rp;

   const strokeIndex = window.yuzutan.strokes.length;
   const targetStroke = referenceKanji[strokeIndex];

   if (!targetStroke) return rp;

   const minStrength = 0.0;
   const maxStrength = 0.1;
   const maxRadius = 109 * 0.5;

   let rawPoint = pointMath.scalePoint(rp, 'input')

   let closestPoint = targetStroke[0];
   let minDistanceSq = Infinity;

   // Directly find the closest sampled point
   for (let i = 0; i < targetStroke.length; i++) {
      const pt = targetStroke[i];
      const dx = rawPoint.x - pt.x;
      const dy = rawPoint.y - pt.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDistanceSq) {
         minDistanceSq = distSq;
         closestPoint = pt;
      }
   }

   const dist = Math.sqrt(minDistanceSq)
   const t = Math.min(1, dist / maxRadius);
   const strength = maxStrength + (minStrength - maxStrength) * t;

   // Pull the pen halfway toward the closest reference point
   return pointMath.scalePoint({
      x: rawPoint.x + (closestPoint.x - rawPoint.x) * strength,
      y: rawPoint.y + (closestPoint.y - rawPoint.y) * strength
   });
}



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


if (CONFIG._experimental) {

   EVENT.on('drw:addstroke', autoFlip)
   EVENT.on('drw:remstroke', autoFlip)
   function autoFlip() {
      if (window.yuzutan.strokes.length == referenceKanji.length) {
         setTimeout(() => {
            flipToBack();
         }, 500);
      }
   }

   EVENT.on('drw:addstroke', showComponent)
   EVENT.on('drw:remstroke', showComponent)
   function showComponent() {
      let id = String(window.yuzutan.strokes.length);
      
      if (componentBreakdown[id]) {
         const currentComponent = document.getElementById("currentComponent");
         currentComponent.innerText = componentBreakdown[id];
         currentComponent.classList.remove("flash-active");
         currentComponent.offsetWidth;
         currentComponent.classList.add("flash-active");
      }
   }
}

