import { db, isFirebaseInitialized } from "./firebaseConfig.js";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

document.addEventListener('DOMContentLoaded', async () => {
    const studentSubmitForm = document.getElementById('student-submit-form');
    if (!studentSubmitForm) return;

    // ── Drawing Tool State ──
    let currentTool = 'interact'; // 'interact', 'pen', 'eraser'
    let strokeColor = '#DF5E5E';
    let strokeWidth = 4;
    let opacity = 1.0;

    // ── Drawing History & Canvas Collections ──
    let activeCanvases = [];
    let drawingHistory = {}; // fileId -> Array of strokes { color, width, tool, points: [{rx, ry}] }
    let globalCanvasHistory = []; // shared global strokes
    let isGlobalCanvas = false;
    let filesList = [];
    let currentLayoutMode = 'tab';

    // Toolbar elements
    const btnDrawMode = document.getElementById('btn-draw-mode');
    const btnDrawPen = document.getElementById('btn-draw-pen');
    const btnDrawEraser = document.getElementById('btn-draw-eraser');
    const btnDrawClear = document.getElementById('btn-draw-clear');
    const colorPicker = document.getElementById('draw-color-picker');
    const opacitySlider = document.getElementById('draw-opacity-slider');
    const thicknessSlider = document.getElementById('draw-thickness-slider');
    const btnCustomColor = document.getElementById('btn-custom-color');
    const presetBtns = document.querySelectorAll('.preset-btn');

    // Sync active canvases pointer-events and opacity
    const updateCanvasPointerEvents = () => {
        activeCanvases.forEach(canvas => {
            if (currentTool === 'interact') {
                canvas.style.pointerEvents = 'none';
            } else {
                canvas.style.pointerEvents = 'auto';
            }
            canvas.style.opacity = opacity;
        });
    };

    const setTool = (tool) => {
        currentTool = tool;
        
        // Reset active UI styles
        if (btnDrawMode) btnDrawMode.classList.remove('active');
        if (btnDrawPen) btnDrawPen.classList.remove('active');
        if (btnDrawEraser) btnDrawEraser.classList.remove('active');
        
        if (btnDrawMode) { btnDrawMode.style.background = ''; btnDrawMode.style.color = ''; }
        if (btnDrawPen) { btnDrawPen.style.background = ''; btnDrawPen.style.color = ''; }
        if (btnDrawEraser) { btnDrawEraser.style.background = ''; btnDrawEraser.style.color = ''; }

        if (tool === 'interact') {
            if (btnDrawMode) {
                btnDrawMode.classList.add('active');
                btnDrawMode.style.background = 'var(--primary)';
                btnDrawMode.style.color = 'white';
            }
        } else if (tool === 'pen') {
            if (btnDrawPen) {
                btnDrawPen.classList.add('active');
                btnDrawPen.style.background = 'var(--primary)';
                btnDrawPen.style.color = 'white';
            }
        } else if (tool === 'eraser') {
            if (btnDrawEraser) {
                btnDrawEraser.classList.add('active');
                btnDrawEraser.style.background = 'var(--primary)';
                btnDrawEraser.style.color = 'white';
            }
        }

        updateCanvasPointerEvents();
    };

    if (btnDrawMode) btnDrawMode.addEventListener('click', () => setTool('interact'));
    if (btnDrawPen) btnDrawPen.addEventListener('click', () => setTool('pen'));
    if (btnDrawEraser) btnDrawEraser.addEventListener('click', () => setTool('eraser'));
    if (btnDrawClear) btnDrawClear.addEventListener('click', () => {
        if (confirm("현재 화면의 필기 내용을 모두 지우시겠습니까?")) {
            if (isGlobalCanvas) {
                globalCanvasHistory = [];
            } else {
                // Find visible/active file ID and clear its drawing history
                const activeWrapper = document.querySelector('.mealkit-viewport-wrapper:not(.hidden)');
                if (activeWrapper) {
                    const fileId = activeWrapper.dataset.fileid;
                    drawingHistory[fileId] = [];
                } else {
                    // For split or scroll where multiple are visible, clear all
                    filesList.forEach(f => { drawingHistory[f.id] = []; });
                }
            }
            activeCanvases.forEach(canvas => {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            });
        }
    });

    if (btnCustomColor && colorPicker) {
        btnCustomColor.addEventListener('click', () => colorPicker.click());
    }

    if (colorPicker) {
        colorPicker.addEventListener('input', (e) => {
            strokeColor = e.target.value;
            presetBtns.forEach(p => {
                p.classList.remove('active');
                p.style.transform = '';
                p.style.boxShadow = '0 0 0 1px rgba(74,62,61,0.2)';
            });
            setTool('pen');
        });
    }

    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            presetBtns.forEach(p => {
                p.classList.remove('active');
                p.style.transform = '';
                p.style.boxShadow = '0 0 0 1px rgba(74,62,61,0.2)';
            });
            btn.classList.add('active');
            btn.style.transform = 'scale(1.2)';
            btn.style.boxShadow = '0 0 0 2px var(--primary)';
            strokeColor = btn.dataset.color;
            if (colorPicker) colorPicker.value = strokeColor;
            setTool('pen');
        });
    });

    if (thicknessSlider) {
        thicknessSlider.addEventListener('input', (e) => {
            strokeWidth = parseInt(e.target.value);
        });
    }

    if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
            opacity = parseFloat(e.target.value);
            updateCanvasPointerEvents();
        });
    }

    // Initialize tools
    setTool('interact');

    // ── Relative Drawing Vector Core ──
    function redrawCanvas(canvas, fileId) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        const history = isGlobalCanvas ? globalCanvasHistory : (drawingHistory[fileId] || []);
        history.forEach(stroke => {
            if (stroke.points.length === 0) return;
            ctx.beginPath();
            
            if (stroke.tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.lineWidth = 24;
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = stroke.width;
            }
            
            const p0 = stroke.points[0];
            ctx.moveTo(p0.rx * canvas.width, p0.ry * canvas.height);
            
            for (let i = 1; i < stroke.points.length; i++) {
                const p = stroke.points[i];
                ctx.lineTo(p.rx * canvas.width, p.ry * canvas.height);
            }
            ctx.stroke();
        });
    }

    function setupDrawingCanvas(canvas, fileId) {
        const ctx = canvas.getContext('2d');
        let isDrawing = false;
        let currentStroke = null;

        const getCoordinates = (e) => {
            const rect = canvas.getBoundingClientRect();
            let clientX = e.clientX;
            let clientY = e.clientY;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            }
            return [clientX - rect.left, clientY - rect.top];
        };

        const startDrawing = (e) => {
            if (currentTool === 'interact') return;
            isDrawing = true;
            const [x, y] = getCoordinates(e);
            
            currentStroke = {
                color: strokeColor,
                width: strokeWidth,
                tool: currentTool,
                points: [{ rx: x / canvas.width, ry: y / canvas.height }]
            };

            if (isGlobalCanvas) {
                globalCanvasHistory.push(currentStroke);
            } else {
                if (!drawingHistory[fileId]) drawingHistory[fileId] = [];
                drawingHistory[fileId].push(currentStroke);
            }
            
            // Draw initial point
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y);
            if (currentTool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.lineWidth = 24;
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = strokeWidth;
            }
            ctx.stroke();
            
            if (currentTool !== 'interact') e.preventDefault();
        };

        const draw = (e) => {
            if (!isDrawing || currentTool === 'interact') return;
            const [x, y] = getCoordinates(e);
            
            currentStroke.points.push({ rx: x / canvas.width, ry: y / canvas.height });
            
            // Render line instantly
            redrawCanvas(canvas, fileId);

            // Redraw global overlays
            if (isGlobalCanvas) {
                activeCanvases.forEach(c => {
                    if (c !== canvas) redrawCanvas(c, c.dataset.fileid);
                });
            }
            if (currentTool !== 'interact') e.preventDefault();
        };

        const stopDrawing = () => {
            isDrawing = false;
            currentStroke = null;
        };

        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);

        canvas.addEventListener('touchstart', startDrawing);
        canvas.addEventListener('touchmove', draw);
        canvas.addEventListener('touchend', stopDrawing);
        canvas.addEventListener('touchcancel', stopDrawing);

        // Responsive resizing
        canvas.resizeHandler = () => {
            const rect = canvas.parentNode.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
            redrawCanvas(canvas, fileId);
        };
        
        window.addEventListener('resize', canvas.resizeHandler);
        // Initial setup delay to guarantee container layout
        setTimeout(canvas.resizeHandler, 250);
    }

    // ── Load Room Config & Auto-Routing ──
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('id');
    const teacherId = urlParams.get('teacherId');
    const mode = urlParams.get('mode');

    if ((!roomId || (!teacherId && mode !== 'preview')) && mode !== 'preview') {
        alert("잘못된 접근입니다. 수업 ID 정보가 누락되었습니다.");
        window.location.href = 'index.html';
        return;
    }

    let copyCount = 0;
    let pasteCount = 0;

    const questionsContainer = document.getElementById('dynamic-questions-container');
    if (questionsContainer) {
        questionsContainer.addEventListener('copy', () => { copyCount++; });
        questionsContainer.addEventListener('paste', () => { pasteCount++; });
    }

    // Dynamic questions renderer
    function renderStudentQuestions(questionsList) {
        const container = document.getElementById('dynamic-questions-container');
        container.innerHTML = '';

        if (!questionsList || questionsList.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">등록된 질문이 없습니다.</p>';
            return;
        }

        questionsList.forEach((q, idx) => {
            const group = document.createElement('div');
            group.className = 'form-group';
            group.style.marginBottom = '1.4rem';

            const label = document.createElement('label');
            label.textContent = `${idx + 1}. ${q.question}`;
            group.appendChild(label);

            if (q.type === 'subjective') {
                const textarea = document.createElement('textarea');
                textarea.rows = 4;
                textarea.placeholder = "답변을 정성껏 작성해 주세요.";
                textarea.required = true;
                textarea.dataset.qid = q.id;
                textarea.dataset.qtitle = q.question;
                textarea.dataset.qtype = q.type;
                group.appendChild(textarea);
            } else if (q.type === 'objective') {
                const select = document.createElement('select');
                select.style.cssText = 'width: 100%; padding: 0.9rem 1.1rem; background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 12px; color: var(--text-primary); font-size: 0.95rem;';
                select.required = true;
                select.dataset.qid = q.id;
                select.dataset.qtitle = q.question;
                select.dataset.qtype = q.type;

                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = '-- 선택해 주세요 --';
                select.appendChild(defaultOption);

                (q.options || []).forEach(opt => {
                    const optEl = document.createElement('option');
                    optEl.value = opt;
                    optEl.textContent = opt;
                    select.appendChild(optEl);
                });
                group.appendChild(select);
            }

            // Screen captures and attachments inside each question
            const attachmentBox = document.createElement('div');
            attachmentBox.className = 'file-attachment-group';
            attachmentBox.innerHTML = `
                <div style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem; flex-wrap: wrap;">
                    <button type="button" class="btn btn-secondary btn-sm btn-trigger-upload-${q.id}" style="padding: 0.45rem 0.9rem; font-size: 0.8rem; border-color: rgba(255,255,255,0.15);">📎 파일 업로드</button>
                    <button type="button" class="btn btn-secondary btn-sm btn-capture-${q.id}" style="padding: 0.45rem 0.9rem; font-size: 0.8rem; background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.25); color: #a5b4fc;">📸 화면 캡처</button>
                    <input type="file" class="file-input-${q.id}" accept="image/*, .pdf, .zip, .docx, .xlsx" style="display: none;">
                </div>
                <div class="file-preview-container-${q.id} hidden" style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.6rem;"></div>
            `;

            const fileInput = attachmentBox.querySelector(`.file-input-${q.id}`);
            const triggerUpload = attachmentBox.querySelector(`.btn-trigger-upload-${q.id}`);
            const captureBtn = attachmentBox.querySelector(`.btn-capture-${q.id}`);
            const previewContainer = attachmentBox.querySelector(`.file-preview-container-${q.id}`);
            let attachedFileData = null;
            let capturedScreenshots = [];

            const renderUploadPreview = () => {
                const existing = previewContainer.querySelector('.upload-preview-item');
                if (existing) existing.remove();

                if (!attachedFileData) {
                    if (capturedScreenshots.length === 0) previewContainer.classList.add('hidden');
                    return;
                }

                const item = document.createElement('div');
                item.className = 'upload-preview-item';
                item.style.cssText = 'display:flex; align-items:center; gap:0.5rem; margin-top:0.4rem; background:rgba(16,185,129,0.07); border:1px solid rgba(16,185,129,0.2); border-radius:10px; padding:0.4rem 0.6rem;';

                if (attachedFileData.type.startsWith('image/')) {
                    const thumb = document.createElement('img');
                    thumb.src = attachedFileData.data;
                    thumb.style.cssText = 'width:64px; height:40px; object-fit:cover; border-radius:6px;';
                    item.appendChild(thumb);
                } else {
                    item.innerHTML += `<span style="font-size:1.4rem;">📎</span>`;
                }

                item.innerHTML += `<span style="font-size:0.75rem; color:var(--text-secondary); flex:1;">${attachedFileData.name} (${Math.round(attachedFileData.size / 1024)}KB)</span>`;
                
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'btn-remove-file';
                removeBtn.innerHTML = '✕';
                removeBtn.style.cssText = 'font-size:0.7rem; padding:0.15rem 0.4rem;';
                removeBtn.addEventListener('click', () => {
                    attachedFileData = null;
                    fileInput.value = '';
                    renderUploadPreview();
                });
                item.appendChild(removeBtn);
                previewContainer.prepend(item);
                previewContainer.classList.remove('hidden');
            };

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                if (file.size > 500 * 1024) {
                    alert('파일 용량 제한: 최대 500KB 이하의 파일만 첨부할 수 있습니다.');
                    fileInput.value = '';
                    return;
                }

                const reader = new FileReader();
                reader.onload = () => {
                    attachedFileData = {
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        data: reader.result
                    };
                    renderUploadPreview();
                };
                reader.readAsDataURL(file);
            });

            captureBtn.addEventListener('click', async () => {
                try {
                    captureBtn.disabled = true;
                    captureBtn.innerHTML = '📸 캡처 중...';
                    await new Promise(r => setTimeout(r, 250));

                    let dataUrl = null;
                    let byteLen = 0;

                    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
                        try {
                            const stream = await navigator.mediaDevices.getDisplayMedia({
                                video: { displaySurface: "browser" },
                                audio: false
                            });

                            const video = document.createElement('video');
                            video.srcObject = stream;
                            video.playsInline = true;
                            await new Promise((resolve, reject) => {
                                video.onloadedmetadata = () => {
                                    video.play().then(resolve).catch(reject);
                                };
                                video.onerror = reject;
                            });

                            await new Promise(r => setTimeout(r, 150));
                            const canvas = document.createElement('canvas');
                            canvas.width = video.videoWidth;
                            canvas.height = video.videoHeight;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                            stream.getTracks().forEach(track => track.stop());
                            video.srcObject = null;

                            dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                            byteLen = Math.ceil(dataUrl.split(',')[1].length * 0.75);
                        } catch (err) {
                            if (err.name === 'NotAllowedError') return;
                            throw err;
                        }
                    }

                    if (!dataUrl && typeof html2canvas !== 'undefined') {
                        const canvas = await html2canvas(document.body, {
                            useCORS: true,
                            allowTaint: false,
                            logging: false,
                            scale: 0.75,
                            ignoreElements: (el) => el.tagName === 'IFRAME' || el.id === 'help-modal'
                        });
                        dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                        byteLen = Math.ceil(dataUrl.split(',')[1].length * 0.75);
                    }

                    if (byteLen > 500 * 1024) {
                        alert('캡처 이미지 크기가 500KB를 초과하여 첨부할 수 없습니다.');
                        return;
                    }

                    const shotName = `capture_q${idx + 1}_${capturedScreenshots.length + 1}.jpg`;
                    capturedScreenshots.push({
                        name: shotName,
                        type: 'image/jpeg',
                        size: byteLen,
                        data: dataUrl
                    });

                    // Render preview items
                    const renderCapturePreviews = () => {
                        previewContainer.querySelectorAll('.capture-preview-item').forEach(el => el.remove());
                        capturedScreenshots.forEach((shot, shotIdx) => {
                            const item = document.createElement('div');
                            item.className = 'capture-preview-item';
                            item.style.cssText = 'display:flex; align-items:center; gap:0.5rem; margin-top:0.4rem; background:rgba(99,102,241,0.07); border:1px solid rgba(99,102,241,0.2); border-radius:10px; padding:0.4rem 0.6rem;';
                            item.innerHTML = `
                                <img src="${shot.data}" style="width:64px; height:40px; object-fit:cover; border-radius:6px; border:1px solid rgba(255,255,255,0.12); cursor:pointer;">
                                <span style="font-size:0.75rem; color:var(--text-secondary); flex:1;">${shot.name} (${Math.round(shot.size / 1024)}KB)</span>
                            `;
                            const delBtn = document.createElement('button');
                            delBtn.type = 'button';
                            delBtn.className = 'btn-remove-file';
                            delBtn.innerHTML = '✕';
                            delBtn.style.cssText = 'font-size:0.7rem; padding:0.15rem 0.4rem;';
                            delBtn.addEventListener('click', () => {
                                capturedScreenshots.splice(shotIdx, 1);
                                renderCapturePreviews();
                                if (capturedScreenshots.length === 0 && !attachedFileData) previewContainer.classList.add('hidden');
                            });
                            item.appendChild(delBtn);
                            previewContainer.appendChild(item);
                        });
                        previewContainer.classList.remove('hidden');
                    };
                    renderCapturePreviews();

                } catch (err) {
                    console.error('캡처 오류:', err);
                    alert('화면 캡처에 실패했습니다: ' + err.message);
                } finally {
                    captureBtn.disabled = false;
                    captureBtn.innerHTML = '📸 화면 캡처';
                }
            });

            triggerUpload.addEventListener('click', () => fileInput.click());

            group.attachedFileGetter = () => {
                if (attachedFileData) return attachedFileData;
                if (capturedScreenshots.length > 0) return capturedScreenshots[capturedScreenshots.length - 1];
                return null;
            };
            group.appendChild(attachmentBox);
            container.appendChild(group);
        });
    }

    // ── Build Mealkit Multi-Viewer Layout ──
    const mealkitTabsHeader = document.getElementById('mealkit-tabs-header');
    const mealkitViewportsBody = document.getElementById('mealkit-viewports-body');

    function buildMealkitLayout() {
        if (!mealkitViewportsBody) return;
        mealkitViewportsBody.innerHTML = '';
        if (mealkitTabsHeader) mealkitTabsHeader.innerHTML = '';
        activeCanvases = [];

        if (filesList.length === 0) {
            mealkitViewportsBody.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);">수업방에 등록된 교안 자료가 없습니다.</p>';
            return;
        }

        if (currentLayoutMode === 'tab') {
            if (mealkitTabsHeader) mealkitTabsHeader.classList.remove('hidden');
            mealkitViewportsBody.style.flexDirection = 'row';

            filesList.forEach((file, index) => {
                // Tab Header Button
                const tabBtn = document.createElement('button');
                tabBtn.type = 'button';
                tabBtn.className = 'tab-btn' + (index === 0 ? ' active' : '');
                tabBtn.style.padding = '0.5rem 1rem';
                tabBtn.style.fontSize = '0.85rem';
                tabBtn.textContent = file.label || file.name;
                tabBtn.dataset.fileid = file.id;

                tabBtn.addEventListener('click', () => {
                    mealkitTabsHeader.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                    tabBtn.classList.add('active');

                    mealkitViewportsBody.querySelectorAll('.mealkit-viewport-wrapper').forEach(wrapper => {
                        if (wrapper.dataset.fileid === file.id) {
                            wrapper.classList.remove('hidden');
                            // Trigger canvas resize update on reveal
                            const c = wrapper.querySelector('canvas');
                            if (c && c.resizeHandler) c.resizeHandler();
                        } else {
                            wrapper.classList.add('hidden');
                        }
                    });
                });
                mealkitTabsHeader.appendChild(tabBtn);

                // Viewport Wrapper
                const wrapper = document.createElement('div');
                wrapper.className = 'mealkit-viewport-wrapper' + (index === 0 ? '' : ' hidden');
                wrapper.dataset.fileid = file.id;
                wrapper.style.cssText = 'position: relative; flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: #0f172a; overflow: hidden;';

                // File element
                const viewer = createViewerElement(file);
                // Canvas layer
                const canvas = document.createElement('canvas');
                canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;';
                canvas.dataset.fileid = file.id;

                wrapper.appendChild(viewer);
                wrapper.appendChild(canvas);
                
                // Add warning banner if external link URL
                appendUrlBannerIfNeeded(wrapper, file, viewer);

                // Add zoom controls
                addZoomControls(wrapper, viewer);

                mealkitViewportsBody.appendChild(wrapper);
                activeCanvases.push(canvas);
                setupDrawingCanvas(canvas, file.id);
            });

        } else if (currentLayoutMode === 'split') {
            if (mealkitTabsHeader) mealkitTabsHeader.classList.add('hidden');
            mealkitViewportsBody.style.cssText = 'display: flex; flex-direction: row; width: 100%; height: 100%; overflow: hidden; position: relative;';

            const count = filesList.length;

            filesList.forEach((file, index) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'mealkit-viewport-wrapper';
                wrapper.dataset.fileid = file.id;
                
                // Equal split width default
                const shareWidth = (100 / count).toFixed(2);
                wrapper.style.cssText = `position: relative; width: ${shareWidth}%; height: 100%; background: #0f172a; overflow: hidden; display: flex; align-items: center; justify-content: center;`;

                const viewer = createViewerElement(file);
                const canvas = document.createElement('canvas');
                canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;';
                canvas.dataset.fileid = file.id;

                wrapper.appendChild(viewer);
                wrapper.appendChild(canvas);

                // Add warning banner if external link URL
                appendUrlBannerIfNeeded(wrapper, file, viewer);

                addZoomControls(wrapper, viewer);
                mealkitViewportsBody.appendChild(wrapper);
                activeCanvases.push(canvas);
                setupDrawingCanvas(canvas, file.id);

                // Add Resizer Bar (except for the last column)
                if (index < count - 1) {
                    const resizer = document.createElement('div');
                    resizer.style.cssText = 'width: 8px; background: rgba(74, 62, 61, 0.25); cursor: col-resize; transition: background 0.2s; position: relative; z-index: 10; display: flex; align-items: center; justify-content: center;';
                    resizer.innerHTML = '<div style="width: 2px; height: 30px; background: rgba(255,255,255,0.4); border-radius: 1px;"></div>';
                    
                    resizer.addEventListener('mouseover', () => { resizer.style.background = 'var(--primary)'; });
                    resizer.addEventListener('mouseout', () => { resizer.style.background = 'rgba(74, 62, 61, 0.25)'; });

                    // Resizer drag handler
                    let startX = 0;
                    let startLeftWidth = 0;

                    const onDrag = (e) => {
                        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                        const deltaX = clientX - startX;
                        let newWidth = startLeftWidth + deltaX;

                        // Constraint boundaries
                        const parentWidth = mealkitViewportsBody.getBoundingClientRect().width;
                        if (newWidth > 100 && newWidth < parentWidth - 100) {
                            wrapper.style.width = newWidth + 'px';
                            wrapper.style.flex = 'none';

                            // Recalculate canvases on resize
                            activeCanvases.forEach(c => { if (c.resizeHandler) c.resizeHandler(); });
                        }
                    };

                    const stopDrag = () => {
                        document.removeEventListener('mousemove', onDrag);
                        document.removeEventListener('mouseup', stopDrag);
                        document.removeEventListener('touchmove', onDrag);
                        document.removeEventListener('touchend', stopDrag);
                    };

                    const initDrag = (e) => {
                        startX = e.touches ? e.touches[0].clientX : e.clientX;
                        startLeftWidth = wrapper.getBoundingClientRect().width;
                        document.addEventListener('mousemove', onDrag);
                        document.addEventListener('mouseup', stopDrag);
                        document.addEventListener('touchmove', onDrag, { passive: true });
                        document.addEventListener('touchend', stopDrag);
                    };

                    resizer.addEventListener('mousedown', initDrag);
                    resizer.addEventListener('touchstart', initDrag, { passive: true });

                    mealkitViewportsBody.appendChild(resizer);
                }
            });

        } else if (currentLayoutMode === 'scroll') {
            if (mealkitTabsHeader) mealkitTabsHeader.classList.add('hidden');
            mealkitViewportsBody.style.cssText = 'display: flex; flex-direction: column; width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden; gap: 1.5rem; padding: 1rem;';

            filesList.forEach((file) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'mealkit-viewport-wrapper';
                wrapper.dataset.fileid = file.id;
                wrapper.style.cssText = 'position: relative; width: 100%; height: 600px; min-height: 400px; background: #0f172a; border-radius: 12px; border: 1px solid var(--border-color); overflow: hidden; display: flex; align-items: center; justify-content: center;';

                const viewer = createViewerElement(file);
                const canvas = document.createElement('canvas');
                canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;';
                canvas.dataset.fileid = file.id;

                wrapper.appendChild(viewer);
                wrapper.appendChild(canvas);

                // Add warning banner if external link URL
                appendUrlBannerIfNeeded(wrapper, file, viewer);

                addZoomControls(wrapper, viewer);
                mealkitViewportsBody.appendChild(wrapper);
                activeCanvases.push(canvas);
                setupDrawingCanvas(canvas, file.id);
            });
        }

        updateCanvasPointerEvents();
    }

    function appendUrlBannerIfNeeded(wrapper, file, viewer) {
        if (file.type === 'url') {
            const banner = document.createElement('div');
            banner.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; background: rgba(224, 122, 95, 0.18); backdrop-filter: blur(4px); padding: 0.45rem 0.8rem; font-size: 0.75rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-color); color: var(--text-primary); z-index: 15; box-sizing: border-box;';
            banner.innerHTML = `
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 0.5rem; text-align: left; font-weight: 500;">🌐 외부 링크 연결됨 (보안 정책 등으로 화면이 나오지 않을 때 우측 버튼을 누르세요)</span>
                <a href="${file.url}" target="_blank" class="btn btn-secondary btn-sm" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; color: #a5b4fc; text-decoration: none; border-color: rgba(99,102,241,0.25); background: rgba(99,102,241,0.1); flex-shrink: 0; border-radius: 4px; border-style: solid; border-width: 1px; display: inline-block;">새 창으로 열기 ↗</a>
            `;
            wrapper.appendChild(banner);
            viewer.style.paddingTop = '32px';
            viewer.style.boxSizing = 'border-box';
        }
    }

    function createViewerElement(file) {
        let viewer;
        if (file.type === 'html' || file.type === 'url') {
            viewer = document.createElement('iframe');
            viewer.src = file.url;
            viewer.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
            viewer.allowFullscreen = true;
            viewer.style.cssText = 'width: 100%; height: 100%; border: none; background: white; transition: transform 0.1s;';
        } else if (file.type === 'pdf') {
            viewer = document.createElement('iframe');
            viewer.src = file.url;
            viewer.loading = 'lazy';
            viewer.style.cssText = 'width: 100%; height: 100%; border: none; background: white; object-fit: contain; transition: transform 0.1s;';
        } else {
            viewer = document.createElement('img');
            viewer.src = file.url;
            viewer.style.cssText = 'max-width: 100%; max-height: 100%; object-fit: contain; background: #1a1515; transition: transform 0.1s;';
        }
        return viewer;
    }

    function addZoomControls(wrapper, viewer) {
        const zoomBar = document.createElement('div');
        zoomBar.style.cssText = 'position: absolute; bottom: 0.8rem; right: 0.8rem; display: flex; align-items: center; gap: 0.4rem; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px); padding: 0.35rem 0.6rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); z-index: 20;';

        let zoomFactor = 1.0;

        const updateZoom = (val) => {
            zoomFactor = Math.max(0.5, Math.min(3.0, val));
            viewer.style.transform = `scale(${zoomFactor})`;
            viewer.style.transformOrigin = 'center center';
            zoomVal.textContent = `${Math.round(zoomFactor * 100)}%`;
        };

        const btnOut = document.createElement('button');
        btnOut.type = 'button';
        btnOut.textContent = '➖';
        btnOut.style.cssText = 'background:none; border:none; color:white; font-size:0.75rem; cursor:pointer; padding:0.1rem;';
        btnOut.addEventListener('click', () => updateZoom(zoomFactor - 0.1));

        const zoomVal = document.createElement('span');
        zoomVal.textContent = '100%';
        zoomVal.style.cssText = 'font-size: 0.75rem; color: white; min-width: 36px; text-align: center; font-weight: 600;';

        const btnIn = document.createElement('button');
        btnIn.type = 'button';
        btnIn.textContent = '➕';
        btnIn.style.cssText = 'background:none; border:none; color:white; font-size:0.75rem; cursor:pointer; padding:0.1rem;';
        btnIn.addEventListener('click', () => updateZoom(zoomFactor + 0.1));

        zoomBar.appendChild(btnOut);
        zoomBar.appendChild(zoomVal);
        zoomBar.appendChild(btnIn);
        wrapper.appendChild(zoomBar);
    }

    // Load configs
    if (mode === 'preview') {
        try {
            const encodedData = urlParams.get('data') || '';
            const sanitizedBase64 = encodedData.replace(/ /g, '+');
            const decodedData = JSON.parse(decodeURIComponent(escape(atob(sanitizedBase64))));

            filesList = decodedData.files || [];
            currentLayoutMode = decodedData.layoutMode || 'tab';
            isGlobalCanvas = decodedData.globalCanvas || false;

            buildMealkitLayout();
            renderStudentQuestions(decodedData.questions);
        } catch (err) {
            console.error("미리보기 파싱 에러:", err);
            alert("미리보기 데이터를 불러오는데 실패했습니다.");
        }
    } else {
        // Fetch room info from Firestore
        try {
            if (!db) throw new Error("Firebase가 초기화되지 않았습니다.");
            const roomRef = doc(db, "users", teacherId, "rooms", roomId);
            const roomSnap = await getDoc(roomRef);

            if (!roomSnap.exists()) {
                alert("존재하지 않는 수업방입니다.");
                window.location.href = 'index.html';
                return;
            }

            const roomData = roomSnap.data();

            // Support legacy rooms backward compatibility
            if (!roomData.files) {
                filesList = [{
                    id: 'sim_legacy',
                    name: roomData.simType === 'url' ? '시뮬레이션 URL' : '시뮬레이션 HTML',
                    label: '시뮬레이션',
                    type: roomData.simType,
                    url: roomData.simType === 'url' ? roomData.simData : ''
                }];
                currentLayoutMode = 'tab';
                isGlobalCanvas = false;
            } else {
                filesList = roomData.files || [];
                currentLayoutMode = roomData.layoutMode || 'tab';
                isGlobalCanvas = roomData.globalCanvas || false;
            }

            buildMealkitLayout();
            renderStudentQuestions(roomData.questions);

        } catch (err) {
            console.error("수업방 조회 에러:", err);
            alert("수업방 데이터를 불러오는 중 오류가 발생했습니다: " + err.message);
            return;
        }
    }

    // Handle answer submission
    studentSubmitForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const studentId = document.getElementById('student-id').value;
        const studentName = document.getElementById('student-name').value;

        // Collect answers
        const answers = [];
        const questionGroups = studentSubmitForm.querySelectorAll('#dynamic-questions-container .form-group');
        questionGroups.forEach(group => {
            const inputElement = group.querySelector('textarea, select');
            if (!inputElement) return;

            const attachedFile = group.attachedFileGetter ? group.attachedFileGetter() : null;

            answers.push({
                id: inputElement.dataset.qid,
                question: inputElement.dataset.qtitle,
                type: inputElement.dataset.qtype,
                answer: inputElement.value,
                file: attachedFile
            });
        });

        // Duplicate submission validation
        if (mode !== 'preview' && isFirebaseInitialized && db) {
            try {
                const subDocRef = doc(db, "users", teacherId, "rooms", roomId, "submissions", studentId);
                const subSnap = await getDoc(subDocRef);
                if (subSnap.exists()) {
                    const overwrite = confirm(`학번 [${studentId}]으로 이미 제출된 답안이 있습니다. 덮어쓰시겠습니까?`);
                    if (!overwrite) return;
                }
            } catch (err) {
                console.warn("중복 제출 확인 조회 유예:", err);
            }
        }

        const btnSubmit = document.getElementById('btn-submit-answer');
        const btnText = btnSubmit.querySelector('.btn-text');
        const spinner = btnSubmit.querySelector('.spinner');

        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');
        btnSubmit.disabled = true;

        if (mode === 'preview') {
            setTimeout(() => {
                const aiBox = document.getElementById('student-ai-box');
                const feedbackText = document.getElementById('student-ai-feedback');

                feedbackText.innerHTML = `🤖 <strong>[미리보기 모드 AI 피드백]</strong><br><br>학생이 제출한 답안에 대한 발문 힌트 예시입니다. 실 배포에서는 Google Gemini API가 실시간 응답합니다.`;
                aiBox.classList.remove('hidden');
                aiBox.scrollIntoView({ behavior: 'smooth' });

                btnText.classList.remove('hidden');
                spinner.classList.add('hidden');
                btnSubmit.disabled = false;

                alert('답안 제출 시뮬레이션 성공! (미리보기)');
            }, 1000);
            return;
        }

        // Export Drawings to submission
        const drawings = {};
        activeCanvases.forEach(canvas => {
            const fileId = canvas.dataset.fileid;
            drawings[fileId] = canvas.toDataURL('image/png');
        });

        let aiHint = "";
        let functionSuccess = false;

        try {
            const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
            const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
            const functionUrl = isLocal 
                ? `https://us-central1-${projectId}.cloudfunctions.net/getAiHint` 
                : '/api/getAiHint';

            const response = await fetch(functionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    teacherId,
                    roomId,
                    studentId,
                    studentName,
                    answers,
                    copyCount,
                    pasteCount,
                    drawings
                })
            });

            if (response.ok) {
                const result = await response.json();
                if (result && result.success) {
                    aiHint = result.hint;
                    functionSuccess = true;
                }
            }
        } catch (err) {
            console.warn("Cloud Function API 호출 실패. 로컬 fallback 모드로 전환합니다.", err);
        }

        if (!functionSuccess) {
            aiHint = `🤖 [가상 AI 피드백] ${studentName} 학생의 다중 뷰어 탐구 활동지를 확인하였습니다. 파일별로 작성해주신 탐구 내용과 그리기 판서를 분석한 결과 훌륭한 접근을 보이고 있습니다! 조금만 더 확장하여 원리를 도출해 보세요.`;
            
            if (isFirebaseInitialized && db) {
                try {
                    const subDocRef = doc(db, "users", teacherId, "rooms", roomId, "submissions", studentId);
                    const submissionData = {
                        studentId,
                        studentName,
                        aiHint,
                        answers,
                        copyCount,
                        pasteCount,
                        drawings,
                        timestamp: serverTimestamp()
                    };
                    await setDoc(subDocRef, submissionData);
                    functionSuccess = true;
                } catch (writeErr) {
                    console.error("Direct Firestore write failed:", writeErr);
                    alert("제출 도중 파이어베이스 쓰기 에러가 발생했습니다: " + writeErr.message);
                    btnText.classList.remove('hidden');
                    spinner.classList.add('hidden');
                    btnSubmit.disabled = false;
                    return;
                }
            } else {
                alert("답안 제출 실패: 오프라인 환경입니다.");
                btnText.classList.remove('hidden');
                spinner.classList.add('hidden');
                btnSubmit.disabled = false;
                return;
            }
        }

        const aiBox = document.getElementById('student-ai-box');
        const feedbackText = document.getElementById('student-ai-feedback');

        feedbackText.textContent = aiHint;
        aiBox.classList.remove('hidden');
        aiBox.scrollIntoView({ behavior: 'smooth' });

        if (functionSuccess) alert('답안이 성공적으로 제출되었습니다!');
        
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
        btnSubmit.disabled = false;
    });
});
