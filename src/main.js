import { db, isFirebaseInitialized } from "./firebaseConfig.js";
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from "firebase/firestore";

document.addEventListener('DOMContentLoaded', async () => {
    const studentSubmitForm = document.getElementById('student-submit-form');
    if (!studentSubmitForm) return;

    // ── Drawing Tool State ──
    let currentTool = 'interact'; // 'interact', 'pen', 'eraser'
    let strokeColor = '#000000';
    let strokeWidth = 4;
    let penWidth = 4;
    let eraserWidth = 24;
    let opacity = 1.0;
    
    // Time tracking variables
    const startTime = Date.now();
    let enableTimeTracking = false;

    // ── Drawing History & Canvas Collections ──
    let activeCanvases = [];
    let drawingHistory = {}; // fileId -> Array of strokes { color, width, tool, points: [{rx, ry}] }
    let globalCanvasHistory = []; // shared global strokes
    let isGlobalCanvas = false;
    let tabsDataList = []; // Array of { id, title, layout, items: [...] }

    // Toolbar elements
    const btnDrawMode = document.getElementById('btn-draw-mode');
    const btnDrawPen = document.getElementById('btn-draw-pen');
    const btnDrawEraser = document.getElementById('btn-draw-eraser');
    const btnDrawClear = document.getElementById('btn-draw-clear');
    const colorPicker = document.getElementById('draw-color-picker');
    const penSizeGroup = document.getElementById('pen-size-group');
    const eraserSizeGroup = document.getElementById('eraser-size-group');
    const penSizeBtns = document.querySelectorAll('.btn-pen-size');
    const eraserSizeBtns = document.querySelectorAll('.btn-eraser-size');
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
        
        // Reset inactive UI styles (High contrast light text)
        [btnDrawMode, btnDrawPen, btnDrawEraser].forEach(btn => {
            if (btn) {
                btn.classList.remove('active');
                btn.style.background = 'rgba(255, 255, 255, 0.08)';
                btn.style.color = '#f1f5f9';
                btn.style.borderColor = 'rgba(255, 255, 255, 0.18)';
            }
        });

        if (tool === 'interact') {
            if (btnDrawMode) {
                btnDrawMode.classList.add('active');
                btnDrawMode.style.background = 'var(--primary)';
                btnDrawMode.style.color = '#ffffff';
                btnDrawMode.style.borderColor = 'var(--primary)';
            }
            if (penSizeGroup) penSizeGroup.classList.remove('hidden');
            if (eraserSizeGroup) eraserSizeGroup.classList.add('hidden');
        } else if (tool === 'pen') {
            if (btnDrawPen) {
                btnDrawPen.classList.add('active');
                btnDrawPen.style.background = 'var(--primary)';
                btnDrawPen.style.color = '#ffffff';
                btnDrawPen.style.borderColor = 'var(--primary)';
            }
            strokeWidth = penWidth;
            if (penSizeGroup) penSizeGroup.classList.remove('hidden');
            if (eraserSizeGroup) eraserSizeGroup.classList.add('hidden');
        } else if (tool === 'eraser') {
            if (btnDrawEraser) {
                btnDrawEraser.classList.add('active');
                btnDrawEraser.style.background = 'var(--primary)';
                btnDrawEraser.style.color = '#ffffff';
                btnDrawEraser.style.borderColor = 'var(--primary)';
            }
            strokeWidth = eraserWidth;
            if (penSizeGroup) penSizeGroup.classList.add('hidden');
            if (eraserSizeGroup) eraserSizeGroup.classList.remove('hidden');
        }

        updateCanvasPointerEvents();
    };

    if (btnDrawMode) btnDrawMode.addEventListener('click', () => setTool('interact'));
    if (btnDrawPen) btnDrawPen.addEventListener('click', () => setTool('pen'));
    if (btnDrawEraser) btnDrawEraser.addEventListener('click', () => setTool('eraser'));
    
    // iPad Pen Size Presets
    penSizeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            penSizeBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderColor = 'rgba(255,255,255,0.2)';
            });
            btn.classList.add('active');
            btn.style.borderColor = 'var(--primary)';
            penWidth = parseInt(btn.dataset.size);
            strokeWidth = penWidth;
        });
    });

    // iPad Eraser Size Presets (소/중/대)
    eraserSizeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            eraserSizeBtns.forEach(b => {
                b.classList.remove('active');
                b.style.background = '#221f1e';
                b.style.color = '#f1f5f9';
                b.style.borderColor = 'rgba(255,255,255,0.2)';
                b.style.fontWeight = 'normal';
            });
            btn.classList.add('active');
            btn.style.background = 'var(--primary)';
            btn.style.color = '#ffffff';
            btn.style.borderColor = 'var(--primary)';
            btn.style.fontWeight = '700';
            eraserWidth = parseInt(btn.dataset.size);
            strokeWidth = eraserWidth;
        });
    });

    if (btnDrawClear) btnDrawClear.addEventListener('click', () => {
        if (confirm("현재 화면의 필기 내용을 모두 지우시겠습니까?")) {
            if (isGlobalCanvas) {
                globalCanvasHistory = [];
            } else {
                const activeWrapper = document.querySelector('.mealkit-viewport-wrapper:not(.hidden)');
                if (activeWrapper) {
                    const fileId = activeWrapper.dataset.fileid;
                    drawingHistory[fileId] = [];
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

    if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
            opacity = parseFloat(e.target.value);
            updateCanvasPointerEvents();
        });
    }

    // Dynamic Page Template & Background Theme selector in student toolbar
    const selectPageTemplate = document.getElementById('select-page-template');
    const selectPageBgtheme = document.getElementById('select-page-bgtheme');

    const updateCurrentTabTemplate = (newType, newTheme) => {
        const activeTabBtn = mealkitTabsHeader ? mealkitTabsHeader.querySelector('.tab-btn.active') : null;
        let currentTabId = activeTabBtn ? activeTabBtn.dataset.tabid : (tabsDataList.length > 0 ? tabsDataList[0].id : null);
        let currentTab = tabsDataList.find(t => t.id === currentTabId);

        if (!currentTab) {
            currentTabId = 'tab_' + Math.random().toString(36).substr(2, 9);
            currentTab = {
                id: currentTabId,
                title: '노트 필기',
                layout: 'split',
                template: newType || 'none',
                bgTheme: newTheme || 'white',
                items: []
            };
            tabsDataList.push(currentTab);
        }

        // Set Tab-level template and bgTheme so entire page background sits underneath all items
        currentTab.template = newType;
        currentTab.bgTheme = newTheme;

        // Also update individual note items if any
        currentTab.items.forEach(item => {
            if (['blank', 'coordinate', 'grid', 'lined'].includes(item.type)) {
                if (newType && newType !== 'none') item.type = newType;
                if (newTheme) item.bgTheme = newTheme;
            }
        });

        buildMealkitLayout(currentTabId);
    };

    if (selectPageTemplate) {
        selectPageTemplate.addEventListener('change', (e) => {
            const currentTheme = selectPageBgtheme ? selectPageBgtheme.value : 'white';
            updateCurrentTabTemplate(e.target.value, currentTheme);
        });
    }

    if (selectPageBgtheme) {
        selectPageBgtheme.addEventListener('change', (e) => {
            const currentTemplate = selectPageTemplate ? selectPageTemplate.value : 'none';
            updateCurrentTabTemplate(currentTemplate, e.target.value);
        });
    }

    // Initialize tools
    setTool('interact');

    // Toggle student panel
    const btnTogglePanel = document.getElementById('btn-toggle-panel');
    const studentLayout = document.querySelector('.student-layout');
    if (btnTogglePanel && studentLayout) {
        btnTogglePanel.addEventListener('click', () => {
            studentLayout.classList.toggle('collapsed');
            const icon = btnTogglePanel.querySelector('.toggle-icon');
            if (studentLayout.classList.contains('collapsed')) {
                icon.textContent = '‹';
            } else {
                icon.textContent = '›';
            }
            // Trigger canvas resize update when layout changes
            setTimeout(() => {
                activeCanvases.forEach(canvas => {
                    if (canvas.resizeHandler) canvas.resizeHandler();
                });
            }, 300);
        });
    }

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
                ctx.lineWidth = stroke.width || eraserWidth || 24;
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = stroke.width || 4;
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
                ctx.lineWidth = strokeWidth;
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

            const isRequired = q.required !== false; // default true

            const label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '0.35rem';
            label.innerHTML = `
                <span>${idx + 1}. ${q.question}</span>
                ${isRequired ? '<span style="color: #ef4444; font-weight: bold;" title="필수 질문">*</span>' : '<span style="font-size: 0.75rem; color: var(--text-secondary); font-weight: normal;">(선택)</span>'}
            `;
            group.appendChild(label);

            if (q.type === 'subjective') {
                const textarea = document.createElement('textarea');
                textarea.rows = 4;
                textarea.placeholder = isRequired ? "답변을 작성해 주세요. (필수)" : "답변을 작성해 주세요. (선택사항)";
                textarea.required = isRequired;
                textarea.dataset.qid = q.id;
                textarea.dataset.qtitle = q.question;
                textarea.dataset.qtype = q.type;
                textarea.dataset.qrequired = isRequired ? 'true' : 'false';
                
                let pastedSegments = [];
                textarea.addEventListener('paste', (e) => {
                    pasteCount++;
                    const pasteText = (e.clipboardData || window.clipboardData).getData('text');
                    if (pasteText) {
                        pastedSegments.push(pasteText);
                    }
                });
                group.pastedSegmentsGetter = () => pastedSegments;

                group.appendChild(textarea);
            } else if (q.type === 'objective') {
                const select = document.createElement('select');
                select.style.cssText = 'width: 100%; padding: 0.9rem 1.1rem; background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color); border-radius: 12px; color: var(--text-primary); font-size: 0.95rem;';
                select.required = isRequired;
                select.dataset.qid = q.id;
                select.dataset.qtitle = q.question;
                select.dataset.qtype = q.type;
                select.dataset.qrequired = isRequired ? 'true' : 'false';

                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = isRequired ? '-- 선택해 주세요 (필수) --' : '-- 선택해 주세요 (선택) --';
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
                                video: {
                                    displaySurface: "monitor"
                                },
                                audio: false,
                                surfaceSwitching: "include"
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

                            await new Promise(r => setTimeout(r, 200));
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

    // ── Build Mealkit Multi-Viewer Layout (2-Tier: Tabs -> Multiple Items) ──
    const mealkitTabsHeader = document.getElementById('mealkit-tabs-header');
    const mealkitViewportsBody = document.getElementById('mealkit-viewports-body');

    function buildMealkitLayout(keepActiveTabId = null) {
        if (!mealkitViewportsBody) return;
        mealkitViewportsBody.innerHTML = '';
        if (mealkitTabsHeader) mealkitTabsHeader.innerHTML = '';
        activeCanvases = [];

        if (tabsDataList.length === 0) {
            mealkitViewportsBody.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);">수업방에 등록된 교안 자료가 없습니다.</p>';
            if (mealkitTabsHeader) mealkitTabsHeader.classList.add('hidden');
            return;
        }

        // Show top tabs header
        if (mealkitTabsHeader) mealkitTabsHeader.classList.remove('hidden');

        // Determine active tab
        let activeIndex = 0;
        if (keepActiveTabId) {
            const foundIdx = tabsDataList.findIndex(t => t.id === keepActiveTabId);
            if (foundIdx !== -1) activeIndex = foundIdx;
        }

        // Render Tabs Bar & Content Panels
        tabsDataList.forEach((tab, index) => {
            const isActive = (index === activeIndex);

            // Tab Header Button
            const tabBtn = document.createElement('button');
            tabBtn.type = 'button';
            tabBtn.className = 'tab-btn' + (isActive ? ' active' : '');
            tabBtn.style.padding = '0.5rem 1rem';
            tabBtn.style.fontSize = '0.85rem';
            tabBtn.textContent = `📑 ${tab.title || ('탭 ' + (index + 1))}`;
            tabBtn.dataset.tabid = tab.id;

            tabBtn.addEventListener('click', () => {
                mealkitTabsHeader.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                tabBtn.classList.add('active');

                mealkitViewportsBody.querySelectorAll('.mealkit-tab-content-panel').forEach(panel => {
                    if (panel.dataset.tabid === tab.id) {
                        panel.classList.remove('hidden');
                        // Trigger canvas resize update on reveal
                        const canvases = panel.querySelectorAll('canvas');
                        canvases.forEach(c => { if (c.resizeHandler) c.resizeHandler(); });

                        // Sync toolbar selects to this tab's note template and background theme
                        const noteItem = (tab.items || []).find(i => ['blank', 'coordinate', 'grid', 'lined'].includes(i.type));
                        if (noteItem) {
                            if (selectPageTemplate) selectPageTemplate.value = noteItem.type || 'blank';
                            if (selectPageBgtheme) selectPageBgtheme.value = noteItem.bgTheme || 'white';
                        }
                    } else {
                        panel.classList.add('hidden');
                    }
                });
            });
            mealkitTabsHeader.appendChild(tabBtn);

            // Content Panel for each tab
            const panel = document.createElement('div');
            panel.className = 'mealkit-tab-content-panel' + (isActive ? '' : ' hidden');
            panel.dataset.tabid = tab.id;
            panel.style.cssText = 'width: 100%; height: 100%; position: relative; overflow: hidden; display: flex; flex-direction: column;';

            // Layout for items within this tab: 'split' vs 'scroll'
            const isScrollMode = (tab.layout === 'scroll');
            const items = tab.items || [];

            const theme = getTemplateThemeColors(tab.bgTheme || 'white');
            const templateType = tab.template || 'none';

            const tabBody = document.createElement('div');
            tabBody.className = 'tab-body-container';
            
            // Apply note template SVG / background underneath all materials
            let bgSvg = '';
            if (templateType === 'coordinate') {
                bgSvg = `
                    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;">
                        <defs>
                            <pattern id="tab-grid-small-${tab.id}" width="20" height="20" patternUnits="userSpaceOnUse">
                                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="${theme.line}" stroke-width="0.8"/>
                            </pattern>
                            <pattern id="tab-grid-large-${tab.id}" width="100" height="100" patternUnits="userSpaceOnUse">
                                <rect width="100" height="100" fill="url(#tab-grid-small-${tab.id})"/>
                                <path d="M 100 0 L 0 0 0 100" fill="none" stroke="${theme.line}" stroke-width="1.4"/>
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#tab-grid-large-${tab.id})"/>
                        <line x1="0" y1="50%" x2="100%" y2="50%" stroke="${theme.axis}" stroke-width="2.5" />
                        <line x1="50%" y1="0" x2="50%" y2="100%" stroke="${theme.axis}" stroke-width="2.5" />
                        <polygon points="100%,50% calc(100% - 10px),calc(50% - 5px) calc(100% - 10px),calc(50% + 5px)" fill="${theme.axis}" />
                        <polygon points="50%,0 calc(50% - 5px),10px calc(50% + 5px),10px" fill="${theme.axis}" />
                        <text x="calc(100% - 18px)" y="calc(50% + 22px)" font-size="16" font-weight="bold" fill="${theme.text}" font-family="Outfit, sans-serif">x</text>
                        <text x="calc(50% + 12px)" y="20" font-size="16" font-weight="bold" fill="${theme.text}" font-family="Outfit, sans-serif">y</text>
                        <text x="calc(50% - 18px)" y="calc(50% + 20px)" font-size="15" font-weight="bold" fill="${theme.text}" font-family="Outfit, sans-serif">O</text>
                    </svg>
                `;
            } else if (templateType === 'grid') {
                bgSvg = `
                    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;">
                        <defs>
                            <pattern id="tab-grid-pat-${tab.id}" width="28" height="28" patternUnits="userSpaceOnUse">
                                <path d="M 28 0 L 0 0 0 28" fill="none" stroke="${theme.line}" stroke-width="1"/>
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#tab-grid-pat-${tab.id})"/>
                    </svg>
                `;
            } else if (templateType === 'lined') {
                bgSvg = `
                    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;">
                        <defs>
                            <pattern id="tab-lined-pat-${tab.id}" width="100%" height="36" patternUnits="userSpaceOnUse">
                                <line x1="0" y1="35" x2="100%" y2="35" stroke="${theme.line}" stroke-width="1.2"/>
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#tab-lined-pat-${tab.id})"/>
                    </svg>
                `;
            }

            if (isScrollMode) {
                tabBody.style.cssText = `display: flex; flex-direction: column; width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden; gap: 1.5rem; padding: 1rem; background: ${theme.bg}; position: relative;`;
            } else {
                tabBody.style.cssText = `display: flex; flex-direction: row; width: 100%; height: 100%; overflow: hidden; position: relative; background: ${theme.bg};`;
            }

            if (bgSvg) {
                const bgLayer = document.createElement('div');
                bgLayer.className = 'tab-background-layer';
                bgLayer.innerHTML = bgSvg;
                tabBody.appendChild(bgLayer);
            }

            if (items.length === 0) {
                const emptyMsg = document.createElement('p');
                emptyMsg.style.cssText = 'text-align: center; padding: 3rem; color: var(--text-secondary); width: 100%; position: relative; z-index: 2;';
                emptyMsg.textContent = '이 탭에 등록된 자료가 없습니다.';
                tabBody.appendChild(emptyMsg);
            } else {
                const count = items.length;

                items.forEach((item, itemIndex) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'mealkit-viewport-wrapper';
                    wrapper.dataset.fileid = item.id;

                    if (isScrollMode) {
                        wrapper.style.cssText = 'position: relative; width: 100%; height: 680px; min-height: 480px; background: #0f172a; border-radius: 12px; border: 1px solid var(--border-color); overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0; z-index: 2;';
                    } else {
                        const shareWidth = (100 / count).toFixed(2);
                        wrapper.style.cssText = `position: relative; width: ${shareWidth}%; height: 100%; background: #0f172a; overflow: hidden; display: flex; align-items: center; justify-content: center; z-index: 2;`;
                    }

                    const viewer = createViewerElement(item);
                    const canvas = document.createElement('canvas');
                    canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;';
                    canvas.dataset.fileid = item.id;

                    wrapper.appendChild(viewer);
                    wrapper.appendChild(canvas);

                    // Add warning banner if external link URL
                    appendUrlBannerIfNeeded(wrapper, item, viewer);
                    addZoomControls(wrapper, viewer);

                    tabBody.appendChild(wrapper);
                    activeCanvases.push(canvas);
                    setupDrawingCanvas(canvas, item.id);

                    // If in Split mode and not last item, add resizer bar
                    if (!isScrollMode && itemIndex < count - 1) {
                        const resizer = document.createElement('div');
                        resizer.style.cssText = 'width: 8px; background: rgba(74, 62, 61, 0.25); cursor: col-resize; transition: background 0.2s; position: relative; z-index: 10; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';
                        resizer.innerHTML = '<div style="width: 2px; height: 30px; background: rgba(255,255,255,0.4); border-radius: 1px;"></div>';

                        resizer.addEventListener('mouseover', () => { resizer.style.background = 'var(--primary)'; });
                        resizer.addEventListener('mouseout', () => { resizer.style.background = 'rgba(74, 62, 61, 0.25)'; });

                        let startX = 0;
                        let startLeftWidth = 0;

                        const onDrag = (e) => {
                            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                            const deltaX = clientX - startX;
                            let newWidth = startLeftWidth + deltaX;

                            const parentWidth = tabBody.getBoundingClientRect().width;
                            if (newWidth > 100 && newWidth < parentWidth - 100) {
                                wrapper.style.width = newWidth + 'px';
                                wrapper.style.flex = 'none';

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

                        tabBody.appendChild(resizer);
                    }
                });
            }

            panel.appendChild(tabBody);
            mealkitViewportsBody.appendChild(panel);
        });

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

    function getTemplateThemeColors(bgTheme) {
        switch (bgTheme) {
            case 'cream':
                return { bg: '#FDFBF7', line: 'rgba(74, 62, 61, 0.12)', axis: '#5C4D4A', text: '#5C4D4A' };
            case 'dark':
                return { bg: '#18181B', line: 'rgba(255, 255, 255, 0.12)', axis: '#E4E4E7', text: '#E4E4E7' };
            case 'green':
                return { bg: '#1E392A', line: 'rgba(255, 255, 255, 0.15)', axis: '#FEF3C7', text: '#FEF3C7' };
            case 'white':
            default:
                return { bg: '#FFFFFF', line: 'rgba(74, 62, 61, 0.10)', axis: '#4A3E3D', text: '#4A3E3D' };
        }
    }

    function createViewerElement(file) {
        let viewer;
        const theme = getTemplateThemeColors(file.bgTheme || 'white');

        if (file.type === 'blank') {
            viewer = document.createElement('div');
            viewer.className = 'note-template-surface';
            viewer.dataset.fileid = file.id;
            viewer.style.cssText = `width: 100%; height: 100%; background: ${theme.bg}; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; user-select: none; transition: background 0.3s;`;
            viewer.innerHTML = `
                <div style="position: absolute; top: 1rem; left: 1.2rem; color: ${theme.text}; opacity: 0.5; font-size: 0.85rem; font-weight: 600; pointer-events: none;">
                    📄 백지 노트 (상단 툴바에서 템플릿과 배경색을 변경할 수 있습니다)
                </div>
            `;
        } else if (file.type === 'coordinate') {
            viewer = document.createElement('div');
            viewer.className = 'note-template-surface';
            viewer.dataset.fileid = file.id;
            viewer.style.cssText = `width: 100%; height: 100%; background: ${theme.bg}; display: flex; align-items: center; justify-content: center; position: relative; user-select: none; overflow: hidden; transition: background 0.3s;`;
            
            viewer.innerHTML = `
                <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; position: absolute; top: 0; left: 0;">
                    <defs>
                        <pattern id="grid-small-${file.id}" width="20" height="20" patternUnits="userSpaceOnUse">
                            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="${theme.line}" stroke-width="0.8"/>
                        </pattern>
                        <pattern id="grid-large-${file.id}" width="100" height="100" patternUnits="userSpaceOnUse">
                            <rect width="100" height="100" fill="url(#grid-small-${file.id})"/>
                            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="${theme.line}" stroke-width="1.4"/>
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid-large-${file.id})"/>
                    
                    <line x1="0" y1="50%" x2="100%" y2="50%" stroke="${theme.axis}" stroke-width="2.5" />
                    <line x1="50%" y1="0" x2="50%" y2="100%" stroke="${theme.axis}" stroke-width="2.5" />
                    
                    <polygon points="100%,50% calc(100% - 10px),calc(50% - 5px) calc(100% - 10px),calc(50% + 5px)" fill="${theme.axis}" />
                    <polygon points="50%,0 calc(50% - 5px),10px calc(50% + 5px),10px" fill="${theme.axis}" />
                    
                    <text x="calc(100% - 18px)" y="calc(50% + 22px)" font-size="16" font-weight="bold" fill="${theme.text}" font-family="Outfit, sans-serif">x</text>
                    <text x="calc(50% + 12px)" y="20" font-size="16" font-weight="bold" fill="${theme.text}" font-family="Outfit, sans-serif">y</text>
                    <text x="calc(50% - 18px)" y="calc(50% + 20px)" font-size="15" font-weight="bold" fill="${theme.text}" font-family="Outfit, sans-serif">O</text>
                </svg>
                <div style="position: absolute; top: 1rem; left: 1.2rem; color: ${theme.text}; opacity: 0.6; font-size: 0.85rem; font-weight: 600; pointer-events: none; padding: 0.2rem 0.5rem; border-radius: 6px;">
                    📐 좌표평면 (원점 및 격자눈금)
                </div>
            `;
        } else if (file.type === 'grid') {
            viewer = document.createElement('div');
            viewer.className = 'note-template-surface';
            viewer.dataset.fileid = file.id;
            viewer.style.cssText = `width: 100%; height: 100%; background: ${theme.bg}; display: flex; align-items: center; justify-content: center; position: relative; user-select: none; overflow: hidden; transition: background 0.3s;`;
            
            viewer.innerHTML = `
                <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; position: absolute; top: 0; left: 0;">
                    <defs>
                        <pattern id="grid-pattern-${file.id}" width="28" height="28" patternUnits="userSpaceOnUse">
                            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="${theme.line}" stroke-width="1"/>
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid-pattern-${file.id})"/>
                </svg>
                <div style="position: absolute; top: 1rem; left: 1.2rem; color: ${theme.text}; opacity: 0.6; font-size: 0.85rem; font-weight: 600; pointer-events: none; padding: 0.2rem 0.5rem; border-radius: 6px;">
                    ⏹️ 모눈종이 노트 (도형 및 정밀 필기)
                </div>
            `;
        } else if (file.type === 'lined') {
            viewer = document.createElement('div');
            viewer.className = 'note-template-surface';
            viewer.dataset.fileid = file.id;
            viewer.style.cssText = `width: 100%; height: 100%; background: ${theme.bg}; display: flex; align-items: center; justify-content: center; position: relative; user-select: none; overflow: hidden; transition: background 0.3s;`;
            
            viewer.innerHTML = `
                <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; position: absolute; top: 0; left: 0;">
                    <defs>
                        <pattern id="lined-pattern-${file.id}" width="100%" height="36" patternUnits="userSpaceOnUse">
                            <line x1="0" y1="35" x2="100%" y2="35" stroke="${theme.line}" stroke-width="1.2"/>
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#lined-pattern-${file.id})"/>
                </svg>
                <div style="position: absolute; top: 1rem; left: 1.2rem; color: ${theme.text}; opacity: 0.6; font-size: 0.85rem; font-weight: 600; pointer-events: none; padding: 0.2rem 0.5rem; border-radius: 6px;">
                    📑 줄노트 (개념 정리 및 풀이과정 작성)
                </div>
            `;
        } else if (file.type === 'html' || file.type === 'url') {
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
        zoomBar.style.cssText = 'position: absolute; bottom: 0.8rem; right: 0.8rem; display: flex; align-items: center; gap: 0.4rem; background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(8px); padding: 0.35rem 0.65rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); z-index: 30; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';

        let zoomFactor = 1.0;
        let panX = 0;
        let panY = 0;

        const updateTransform = () => {
            viewer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomFactor})`;
            viewer.style.transformOrigin = 'center center';
            zoomVal.textContent = `${Math.round(zoomFactor * 100)}%`;
            if (zoomFactor > 1.0) {
                wrapper.style.cursor = (currentTool === 'interact') ? 'grab' : 'default';
            } else {
                wrapper.style.cursor = 'default';
            }
        };

        const updateZoom = (val) => {
            zoomFactor = Math.max(0.5, Math.min(3.5, val));
            if (zoomFactor === 1.0) {
                panX = 0;
                panY = 0;
            }
            updateTransform();
        };

        // Pan/Drag support when zoomed in during 'interact' mode
        let isPanning = false;
        let startPanX = 0;
        let startPanY = 0;

        wrapper.addEventListener('mousedown', (e) => {
            if (currentTool !== 'interact' || zoomFactor <= 1.0) return;
            // Ignore click if clicking zoomBar itself
            if (e.target.closest('button') || e.target.closest('.zoom-bar')) return;
            isPanning = true;
            startPanX = e.clientX - panX;
            startPanY = e.clientY - panY;
            wrapper.style.cursor = 'grabbing';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            panX = e.clientX - startPanX;
            panY = e.clientY - startPanY;
            updateTransform();
        });

        window.addEventListener('mouseup', () => {
            if (isPanning) {
                isPanning = false;
                if (zoomFactor > 1.0 && currentTool === 'interact') {
                    wrapper.style.cursor = 'grab';
                }
            }
        });

        const btnOut = document.createElement('button');
        btnOut.type = 'button';
        btnOut.textContent = '➖';
        btnOut.title = '축소';
        btnOut.style.cssText = 'background:none; border:none; color:white; font-size:0.8rem; cursor:pointer; padding:0.15rem 0.3rem;';
        btnOut.addEventListener('click', () => updateZoom(zoomFactor - 0.15));

        const zoomVal = document.createElement('span');
        zoomVal.textContent = '100%';
        zoomVal.title = '클릭 시 100% 원본 크기 복귀';
        zoomVal.style.cssText = 'font-size: 0.78rem; color: #f8fafc; min-width: 40px; text-align: center; font-weight: 700; cursor: pointer; user-select: none;';
        zoomVal.addEventListener('click', () => {
            panX = 0;
            panY = 0;
            updateZoom(1.0);
        });

        const btnIn = document.createElement('button');
        btnIn.type = 'button';
        btnIn.textContent = '➕';
        btnIn.title = '확대';
        btnIn.style.cssText = 'background:none; border:none; color:white; font-size:0.8rem; cursor:pointer; padding:0.15rem 0.3rem;';
        btnIn.addEventListener('click', () => updateZoom(zoomFactor + 0.15));

        const btnReset = document.createElement('button');
        btnReset.type = 'button';
        btnReset.textContent = '↺';
        btnReset.title = '화면 위치 및 배율 초기화';
        btnReset.style.cssText = 'background:none; border:none; color:#94a3b8; font-size:0.85rem; cursor:pointer; padding:0.15rem 0.2rem; margin-left:0.2rem;';
        btnReset.addEventListener('click', () => {
            panX = 0;
            panY = 0;
            updateZoom(1.0);
        });

        zoomBar.appendChild(btnOut);
        zoomBar.appendChild(zoomVal);
        zoomBar.appendChild(btnIn);
        zoomBar.appendChild(btnReset);
        wrapper.appendChild(zoomBar);
    }

    // Load configs
    if (mode === 'preview') {
        try {
            let decodedData = null;
            const sessionDataStr = sessionStorage.getItem('student_preview_data');
            if (sessionDataStr) {
                try {
                    decodedData = JSON.parse(sessionDataStr);
                } catch (e) {
                    console.warn("SessionStorage parse error, trying URL data:", e);
                }
            }

            if (!decodedData) {
                const encodedData = urlParams.get('data') || '';
                const sanitizedBase64 = encodedData.replace(/ /g, '+');
                decodedData = JSON.parse(decodeURIComponent(escape(atob(sanitizedBase64))));
            }

            if (decodedData.tabs && Array.isArray(decodedData.tabs)) {
                tabsDataList = decodedData.tabs;
            } else if (decodedData.files && Array.isArray(decodedData.files)) {
                tabsDataList = decodedData.files.map(f => ({
                    id: f.id,
                    title: f.label || f.name,
                    layout: f.layout || 'split',
                    items: [{ id: 'item_' + f.id, name: f.name || f.label, type: f.type, url: f.url }]
                }));
            } else {
                tabsDataList = [];
            }

            isGlobalCanvas = decodedData.globalCanvas || false;
            enableTimeTracking = decodedData.enableTimeTracking || false;

            buildMealkitLayout();
            renderStudentQuestions(decodedData.questions);
            
            // Start student-side timer if enabled
            if (enableTimeTracking) {
                const timerContainer = document.getElementById('student-timer-container');
                const timerVal = document.getElementById('student-elapsed-timer');
                if (timerContainer && timerVal) {
                    timerContainer.classList.remove('hidden');
                    setInterval(() => {
                        const elapsed = Math.round((Date.now() - startTime) / 1000);
                        const min = Math.floor(elapsed / 60);
                        const sec = elapsed % 60;
                        timerVal.textContent = `${min}분 ${sec}초`;
                    }, 1000);
                }
            }
        } catch (err) {
            console.error("미리보기 파싱 에러:", err);
            alert("미리보기 데이터를 불러오는데 실패했습니다.");
        }
    } else {
        // Fetch room info from Firestore & subscribe to real-time updates for tabs
        try {
            if (!db) throw new Error("Firebase가 초기화되지 않았습니다.");
            const roomRef = doc(db, "users", teacherId, "rooms", roomId);
            let isInitialLoad = true;

            onSnapshot(roomRef, (roomSnap) => {
                if (!roomSnap.exists()) {
                    alert("존재하지 않거나 삭제된 수업방입니다.");
                    window.location.href = 'index.html';
                    return;
                }

                const roomData = roomSnap.data();

                // Track currently selected tab ID before updating
                const activeTabBtn = mealkitTabsHeader ? mealkitTabsHeader.querySelector('.tab-btn.active') : null;
                const currentActiveTabId = activeTabBtn ? activeTabBtn.dataset.tabid : null;

                // Support new tabs structure and legacy rooms backward compatibility
                if (roomData.tabs && Array.isArray(roomData.tabs)) {
                    tabsDataList = roomData.tabs;
                } else if (roomData.files && Array.isArray(roomData.files)) {
                    tabsDataList = roomData.files.map(f => ({
                        id: f.id,
                        title: f.label || f.name,
                        layout: f.layout || 'split',
                        items: [{ id: 'item_' + f.id, name: f.name || f.label, type: f.type, url: f.url }]
                    }));
                } else if (roomData.simType) {
                    tabsDataList = [{
                        id: 'tab_legacy',
                        title: '시뮬레이션',
                        layout: 'split',
                        items: [{
                            id: 'item_legacy',
                            name: roomData.simType === 'url' ? '시뮬레이션 URL' : '시뮬레이션 HTML',
                            type: roomData.simType,
                            url: roomData.simType === 'url' ? roomData.simData : ''
                        }]
                    }];
                } else {
                    tabsDataList = [];
                }

                isGlobalCanvas = roomData.globalCanvas || false;
                enableTimeTracking = roomData.enableTimeTracking !== false;

                // Rebuild layout with active tab preserved
                buildMealkitLayout(currentActiveTabId);

                // Initial questions & timer setup
                if (isInitialLoad) {
                    renderStudentQuestions(roomData.questions);

                    // Start student-side timer if enabled
                    if (enableTimeTracking) {
                        const timerContainer = document.getElementById('student-timer-container');
                        const timerVal = document.getElementById('student-elapsed-timer');
                        if (timerContainer && timerVal) {
                            timerContainer.classList.remove('hidden');
                            setInterval(() => {
                                const elapsed = Math.round((Date.now() - startTime) / 1000);
                                const min = Math.floor(elapsed / 60);
                                const sec = elapsed % 60;
                                timerVal.textContent = `${min}분 ${sec}초`;
                            }, 1000);
                        }
                    }
                    isInitialLoad = false;
                }
            }, (err) => {
                console.error("수업방 실시간 구독 에러:", err);
            });

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
            const pastedSegments = group.pastedSegmentsGetter ? group.pastedSegmentsGetter() : [];

            answers.push({
                id: inputElement.dataset.qid,
                question: inputElement.dataset.qtitle,
                type: inputElement.dataset.qtype,
                answer: inputElement.value,
                file: attachedFile,
                pastedSegments: pastedSegments
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

                feedbackText.innerHTML = `<strong>[미리보기 모드]</strong><br><br>학생이 제출한 답안 저장이 정상적으로 완료되었습니다.`;
                aiBox.classList.remove('hidden');
                aiBox.scrollIntoView({ behavior: 'smooth' });

                btnText.classList.remove('hidden');
                spinner.classList.add('hidden');
                btnSubmit.disabled = false;

                alert('답안 제출 시뮬레이션 성공! (미리보기)');
            }, 600);
            return;
        }

        // Export Drawings to submission
        const drawings = {};
        activeCanvases.forEach(canvas => {
            const fileId = canvas.dataset.fileid;
            drawings[fileId] = canvas.toDataURL('image/png');
        });

        // Direct submission save to Firestore
        if (isFirebaseInitialized && db) {
            try {
                const subDocRef = doc(db, "users", teacherId, "rooms", roomId, "submissions", studentId);
                const elapsedSeconds = enableTimeTracking ? Math.round((Date.now() - startTime) / 1000) : null;
                const submissionData = {
                    studentId,
                    studentName,
                    answers,
                    copyCount,
                    pasteCount,
                    drawings,
                    elapsedSeconds,
                    timestamp: serverTimestamp()
                };
                await setDoc(subDocRef, submissionData);

                const aiBox = document.getElementById('student-ai-box');
                const feedbackText = document.getElementById('student-ai-feedback');
                if (feedbackText) feedbackText.textContent = `${studentName} 학생의 탐구 답안이 성공적으로 저장되었습니다. 수고하셨습니다!`;
                if (aiBox) {
                    aiBox.classList.remove('hidden');
                    aiBox.scrollIntoView({ behavior: 'smooth' });
                }

                alert('답안이 성공적으로 제출되었습니다!');
            } catch (writeErr) {
                console.error("Direct Firestore write failed:", writeErr);
                alert("제출 도중 오류가 발생했습니다: " + writeErr.message);
            } finally {
                btnText.classList.remove('hidden');
                spinner.classList.add('hidden');
                btnSubmit.disabled = false;
            }
        } else {
            alert("답안 제출 실패: 네트워크 또는 Firebase 연결 상태를 확인해 주세요.");
            btnText.classList.remove('hidden');
            spinner.classList.add('hidden');
            btnSubmit.disabled = false;
        }
    });

    // ── Student-Side QR Modal Controls ──
    const btnShowQrStudent = document.getElementById('btn-show-qr-student');
    const studentQrModal = document.getElementById('student-qr-modal');
    const btnCloseStudentQr = document.getElementById('btn-close-student-qr');
    const btnDoneStudentQr = document.getElementById('btn-done-student-qr');
    const btnCopyStudentLink = document.getElementById('btn-copy-student-link');
    const studentQrImg = document.getElementById('student-qr-img');

    if (btnShowQrStudent && studentQrModal) {
        btnShowQrStudent.addEventListener('click', () => {
            const currentStudentUrl = window.location.href;
            if (studentQrImg) {
                studentQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(currentStudentUrl)}`;
            }
            studentQrModal.classList.remove('hidden');
        });

        const hideStudentQr = () => studentQrModal.classList.add('hidden');
        if (btnCloseStudentQr) btnCloseStudentQr.addEventListener('click', hideStudentQr);
        if (btnDoneStudentQr) btnDoneStudentQr.addEventListener('click', hideStudentQr);

        if (btnCopyStudentLink) {
            btnCopyStudentLink.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(window.location.href);
                    alert("수업 참여 링크가 복사되었습니다!");
                } catch (e) {
                    prompt("아래 링크를 복사하세요:", window.location.href);
                }
            });
        }
    }
});
