import { db, isFirebaseInitialized } from "./firebaseConfig.js";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

document.addEventListener('DOMContentLoaded', async () => {
    const studentSubmitForm = document.getElementById('student-submit-form');
    if (!studentSubmitForm) return;

    // ── Drawing Canvas Overlay Setup ──
    const canvas = document.getElementById('drawing-canvas');
    let ctx = null;
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentTool = 'interact'; // 'interact', 'pen', 'eraser'
    let strokeColor = '#E07A5F';

    if (canvas) {
        ctx = canvas.getContext('2d');
        
        // Resize canvas to match its bounding box
        const resizeCanvas = () => {
            const rect = canvas.getBoundingClientRect();
            
            // Backup content before resizing clears the canvas
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(canvas, 0, 0);

            canvas.width = rect.width;
            canvas.height = rect.height;

            // Restore backed up content
            ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, canvas.width, canvas.height);
            
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        };

        window.addEventListener('resize', resizeCanvas);
        // Delay slightly to ensure iframe wrapper layout is established
        setTimeout(resizeCanvas, 500);

        // Drawing Toolbar elements
        const btnDrawMode = document.getElementById('btn-draw-mode');
        const btnDrawPen = document.getElementById('btn-draw-pen');
        const btnDrawEraser = document.getElementById('btn-draw-eraser');
        const btnDrawClear = document.getElementById('btn-draw-clear');
        const colorPicker = document.getElementById('draw-color-picker');
        const opacitySlider = document.getElementById('draw-opacity-slider');

        const setTool = (tool) => {
            currentTool = tool;
            
            // Reset active classes
            if (btnDrawMode) btnDrawMode.classList.remove('active');
            if (btnDrawPen) btnDrawPen.classList.remove('active');
            if (btnDrawEraser) btnDrawEraser.classList.remove('active');
            
            if (btnDrawMode) { btnDrawMode.style.background = ''; btnDrawMode.style.color = ''; }
            if (btnDrawPen) { btnDrawPen.style.background = ''; btnDrawPen.style.color = ''; }
            if (btnDrawEraser) { btnDrawEraser.style.background = ''; btnDrawEraser.style.color = ''; }

            if (tool === 'interact') {
                canvas.style.pointerEvents = 'none';
                if (btnDrawMode) {
                    btnDrawMode.classList.add('active');
                    btnDrawMode.style.background = 'var(--primary)';
                    btnDrawMode.style.color = 'white';
                }
            } else {
                canvas.style.pointerEvents = 'auto';
                if (tool === 'pen' && btnDrawPen) {
                    btnDrawPen.classList.add('active');
                    btnDrawPen.style.background = 'var(--primary)';
                    btnDrawPen.style.color = 'white';
                } else if (tool === 'eraser' && btnDrawEraser) {
                    btnDrawEraser.classList.add('active');
                    btnDrawEraser.style.background = 'var(--primary)';
                    btnDrawEraser.style.color = 'white';
                }
            }
        };

        if (btnDrawMode) btnDrawMode.addEventListener('click', () => setTool('interact'));
        if (btnDrawPen) btnDrawPen.addEventListener('click', () => setTool('pen'));
        if (btnDrawEraser) btnDrawEraser.addEventListener('click', () => setTool('eraser'));
        if (btnDrawClear) btnDrawClear.addEventListener('click', () => {
            if (confirm("필기된 내용을 모두 지우시겠습니까?")) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        });
        if (colorPicker) colorPicker.addEventListener('input', (e) => {
            strokeColor = e.target.value;
        });
        if (opacitySlider) opacitySlider.addEventListener('input', (e) => {
            canvas.style.opacity = e.target.value;
        });

        // Initialize tool to interact
        setTool('interact');

        const startDrawing = (x, y) => {
            if (currentTool === 'interact') return;
            isDrawing = true;
            [lastX, lastY] = [x, y];
        };

        const draw = (x, y) => {
            if (!isDrawing || currentTool === 'interact') return;

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(x, y);

            if (currentTool === 'pen') {
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 4;
                ctx.globalCompositeOperation = 'source-over';
            } else if (currentTool === 'eraser') {
                ctx.lineWidth = 24;
                ctx.globalCompositeOperation = 'destination-out';
            }
            
            ctx.stroke();
            [lastX, lastY] = [x, y];
        };

        const stopDrawing = () => {
            isDrawing = false;
        };

        // Mouse events
        canvas.addEventListener('mousedown', (e) => {
            const rect = canvas.getBoundingClientRect();
            startDrawing(e.clientX - rect.left, e.clientY - rect.top);
        });
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            draw(e.clientX - rect.left, e.clientY - rect.top);
        });
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);

        // Touch events for tablets/mobiles
        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                const rect = canvas.getBoundingClientRect();
                startDrawing(e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top);
                if (currentTool !== 'interact') e.preventDefault();
            }
        });
        canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                const rect = canvas.getBoundingClientRect();
                draw(e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top);
                if (currentTool !== 'interact') e.preventDefault();
            }
        });
        canvas.addEventListener('touchend', stopDrawing);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('id');
    const teacherId = urlParams.get('teacherId');
    const mode = urlParams.get('mode');

    if ((!roomId || (!teacherId && mode !== 'preview')) && mode !== 'preview') {
        alert("잘못된 접근입니다. 수업방 ID 또는 교사 식별 정보가 지정되지 않았습니다.");
        window.location.href = 'index.html';
        return;
    }

    let roomData = null;
    let copyCount = 0;
    let pasteCount = 0;

    // Track copy/paste events inside dynamic questions
    const questionsContainer = document.getElementById('dynamic-questions-container');
    if (questionsContainer) {
        questionsContainer.addEventListener('copy', () => {
            copyCount++;
        });
        questionsContainer.addEventListener('paste', () => {
            pasteCount++;
        });
    }

    // Helper to auto-append embed parameters for Streamlit apps to bypass third-party cookie redirect loops
    const getEmbeddableUrl = (url) => {
        if (!url) return "";
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname.includes("streamlit.app") || urlObj.hostname.includes("streamlit.io")) {
                if (!urlObj.searchParams.has("embed") && !urlObj.searchParams.has("embedded")) {
                    urlObj.searchParams.set("embed", "true");
                }
            }
            return urlObj.toString();
        } catch (e) {
            if (url.includes("streamlit.app") || url.includes("streamlit.io")) {
                if (!url.includes("embed=true") && !url.includes("embedded=true")) {
                    const separator = url.includes("?") ? "&" : "?";
                    return url + separator + "embed=true";
                }
            }
            return url;
        }
    };

    // Render questions dynamically in student panel
    function renderStudentQuestions(questionsList) {
        const container = document.getElementById('dynamic-questions-container');
        container.innerHTML = '';

        if (!questionsList || questionsList.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">수업방에 등록된 탐구 질문이 없습니다.</p>';
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
                select.style.width = '100%';
                select.style.padding = '0.9rem 1.1rem';
                select.style.background = 'rgba(15, 23, 42, 0.6)';
                select.style.border = '1px solid var(--border-color)';
                select.style.borderRadius = '12px';
                select.style.color = 'var(--text-primary)';
                select.style.fontSize = '0.95rem';
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

            // File Attachment & Capture UI for each question
            const attachmentBox = document.createElement('div');
            attachmentBox.className = 'file-attachment-group';
            attachmentBox.innerHTML = `
                <div style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem; flex-wrap: wrap;">
                    <button type="button" class="btn btn-secondary btn-sm btn-trigger-upload-${q.id}" style="padding: 0.45rem 0.9rem; font-size: 0.8rem; border-color: rgba(255,255,255,0.15);">📎 파일 업로드</button>
                    <button type="button" class="btn btn-secondary btn-sm btn-capture-${q.id}" style="padding: 0.45rem 0.9rem; font-size: 0.8rem; background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.25); color: #a5b4fc;">📸 화면 캡처</button>
                    <input type="file" class="file-input-${q.id}" accept="image/*, .pdf, .zip, .docx, .xlsx" style="display: none;">
                </div>
                <div class="file-preview-container-${q.id} hidden" style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.6rem;">
                </div>
            `;

            const fileInput = attachmentBox.querySelector(`.file-input-${q.id}`);
            const triggerUpload = attachmentBox.querySelector(`.btn-trigger-upload-${q.id}`);
            const captureBtn = attachmentBox.querySelector(`.btn-capture-${q.id}`);
            const previewContainer = attachmentBox.querySelector(`.file-preview-container-${q.id}`);
            let attachedFileData = null;
            const pastedSegments = [];

            // Bind paste event tracking for textareas
            const textInput = group.querySelector('textarea');
            if (textInput) {
                textInput.addEventListener('paste', (e) => {
                    const pastedText = e.clipboardData ? e.clipboardData.getData('text') : '';
                    if (pastedText.trim().length > 0) {
                        pastedSegments.push(pastedText);
                    }
                });
            }

            // Handle file upload — independent of captures
            const renderUploadPreview = () => {
                // Remove existing upload preview item if present
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
                    const icon = document.createElement('span');
                    icon.style.cssText = 'font-size:1.4rem;';
                    icon.textContent = '📎';
                    item.appendChild(icon);
                }

                const label = document.createElement('span');
                label.style.cssText = 'font-size:0.75rem; color:var(--text-secondary); flex:1;';
                label.textContent = `${attachedFileData.name} (${Math.round(attachedFileData.size / 1024)}KB)`;
                item.appendChild(label);

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
                    alert('파일 용량이 너무 큽니다! 최대 500KB 이하의 파일만 첨부할 수 있습니다.');
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

            // ── 화면 캡처: html2canvas 자동 캡처 (학생 현재 화면 전체) ─────────
            // 여러 번 캡처 가능, 각 캡처본은 배열로 관리되며 파일 업로드와 독립적.
            let capturedScreenshots = [];

            const renderCapturePreviews = () => {
                const existingItems = previewContainer.querySelectorAll('.capture-preview-item');
                existingItems.forEach(el => el.remove());

                capturedScreenshots.forEach((shot, shotIdx) => {
                    const item = document.createElement('div');
                    item.className = 'capture-preview-item';
                    item.style.cssText = 'display:flex; align-items:center; gap:0.5rem; margin-top:0.4rem; background:rgba(99,102,241,0.07); border:1px solid rgba(99,102,241,0.2); border-radius:10px; padding:0.4rem 0.6rem;';

                    const thumb = document.createElement('img');
                    thumb.src = shot.data;
                    thumb.style.cssText = 'width:64px; height:40px; object-fit:cover; border-radius:6px; border:1px solid rgba(255,255,255,0.12); cursor:pointer;';
                    thumb.title = '클릭하면 크게 봅니다';
                    thumb.addEventListener('click', () => {
                        const modal = document.getElementById('image-preview-modal') || window.open(shot.data, '_blank');
                        if (modal) {
                            const zoomedImg = document.getElementById('zoomed-image');
                            if (zoomedImg) { zoomedImg.src = shot.data; modal.classList.remove('hidden'); }
                        }
                    });
                    item.appendChild(thumb);

                    const label = document.createElement('span');
                    label.style.cssText = 'font-size:0.75rem; color:var(--text-secondary); flex:1;';
                    label.textContent = `${shot.name} (${Math.round(shot.size / 1024)}KB)`;
                    item.appendChild(label);

                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'btn-remove-file';
                    delBtn.innerHTML = '✕';
                    delBtn.style.cssText = 'font-size:0.7rem; padding:0.15rem 0.4rem;';
                    delBtn.addEventListener('click', () => {
                        capturedScreenshots.splice(shotIdx, 1);
                        renderCapturePreviews();
                        if (capturedScreenshots.length === 0 && !attachedFileData) {
                            previewContainer.classList.add('hidden');
                        }
                    });
                    item.appendChild(delBtn);
                    previewContainer.appendChild(item);
                });

                if (capturedScreenshots.length > 0 || attachedFileData) {
                    previewContainer.classList.remove('hidden');
                }
            };

            // 화면 캡처 버튼 — getDisplayMedia API로 교차 출처(CORS) 제한 없이 보이는 화면 전체/탭 캡처
            captureBtn.addEventListener('click', async () => {
                try {
                    captureBtn.disabled = true;
                    captureBtn.innerHTML = '📸 캡처 중...';

                    // DOM 업데이트 및 전환 연출 대기
                    await new Promise(resolve => setTimeout(resolve, 250));

                    let dataUrl = null;
                    let byteLen = 0;

                    // 1. 최신 브라우저의 Screen Capture API 지원 여부 확인
                    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
                        try {
                            const stream = await navigator.mediaDevices.getDisplayMedia({
                                video: {
                                    displaySurface: "browser" // 브라우저 탭 선택 우선 제안
                                },
                                audio: false
                            });

                            // 비디오 스트림을 캔버스에 그리기 위해 video 엘리먼트 바인딩
                            const video = document.createElement('video');
                            video.srcObject = stream;
                            video.playsInline = true;

                            await new Promise((resolve, reject) => {
                                video.onloadedmetadata = () => {
                                    video.play().then(resolve).catch(reject);
                                };
                                video.onerror = reject;
                            });

                            // 프레임 렌더링 안정화를 위해 아주 잠깐 대기
                            await new Promise(resolve => setTimeout(resolve, 150));

                            const canvas = document.createElement('canvas');
                            canvas.width = video.videoWidth;
                            canvas.height = video.videoHeight;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                            // 스트림 즉시 정리 및 종료
                            stream.getTracks().forEach(track => track.stop());
                            video.srcObject = null;

                            dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                            byteLen = Math.ceil(dataUrl.split(',')[1].length * 0.75);
                        } catch (captureErr) {
                            // 사용자가 취소(NotAllowedError)한 경우 프로세스 중단
                            if (captureErr.name === 'NotAllowedError') {
                                console.log('사용자가 화면 공유를 취소했습니다.');
                                return;
                            }
                            throw captureErr; // 다른 에러는 fallback 처리 또는 예외 처리로 보냄
                        }
                    }

                    // 2. getDisplayMedia 미지원 또는 실패 시 html2canvas 캡처 fallback 실행 (시뮬레이션 iframe 제외)
                    if (!dataUrl) {
                        if (typeof html2canvas === 'undefined') {
                            alert('캡처 라이브러리가 로드되지 않아 캡처를 완료할 수 없습니다.');
                            return;
                        }
                        const canvas = await html2canvas(document.body, {
                            useCORS: true,
                            allowTaint: false,
                            logging: false,
                            scale: 0.75,
                            ignoreElements: (el) => 
                                el.id === 'image-preview-modal' || 
                                el.id === 'reset-modal' || 
                                el.tagName === 'IFRAME' || 
                                el.classList.contains('simulation-container')
                        });
                        dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                        byteLen = Math.ceil(dataUrl.split(',')[1].length * 0.75);
                    }

                    // 500KB 제한에 맞추어 품질 단계별 압축
                    if (byteLen > 500 * 1024) {
                        const imgTemp = new Image();
                        imgTemp.src = dataUrl;
                        await new Promise(r => imgTemp.onload = r);
                        
                        const canvasComp = document.createElement('canvas');
                        canvasComp.width = imgTemp.width;
                        canvasComp.height = imgTemp.height;
                        const ctxComp = canvasComp.getContext('2d');
                        ctxComp.drawImage(imgTemp, 0, 0);

                        dataUrl = canvasComp.toDataURL('image/jpeg', 0.5);
                        byteLen = Math.ceil(dataUrl.split(',')[1].length * 0.75);

                        if (byteLen > 500 * 1024) {
                            dataUrl = canvasComp.toDataURL('image/jpeg', 0.3);
                            byteLen = Math.ceil(dataUrl.split(',')[1].length * 0.75);
                        }
                    }

                    if (byteLen > 500 * 1024) {
                        alert('캡처 이미지 크기(500KB)를 초과하여 첨부할 수 없습니다. 브라우저 창 크기를 줄여 시도해 주세요.');
                        return;
                    }

                    const shotName = `capture_q${idx + 1}_${capturedScreenshots.length + 1}.jpg`;
                    capturedScreenshots.push({
                        name: shotName,
                        type: 'image/jpeg',
                        size: byteLen,
                        data: dataUrl
                    });
                    renderCapturePreviews();

                } catch (err) {
                    console.error('화면 캡처 오류:', err);
                    alert('화면 캡처에 실패했습니다: ' + err.message);
                } finally {
                    captureBtn.disabled = false;
                    captureBtn.innerHTML = '📸 화면 캡처';
                }
            });

            // Trigger file input click
            triggerUpload.addEventListener('click', () => fileInput.click());

            // attachedFileGetter: 파일 업로드 우선, 없으면 마지막 캡처 반환
            group.attachedFileGetter = () => {
                if (attachedFileData) return attachedFileData;
                if (capturedScreenshots.length > 0) return capturedScreenshots[capturedScreenshots.length - 1];
                return null;
            };
            // screenshotsGetter: 모든 캡처 배열 반환
            group.screenshotsGetter = () => capturedScreenshots;
            group.pastedSegmentsGetter = () => pastedSegments;
            group.appendChild(attachmentBox);

            container.appendChild(group);
        });
    }

    // Load data depending on mode
    if (mode === 'preview') {
        try {
            const encodedData = urlParams.get('data') || '';
            const sanitizedBase64 = encodedData.replace(/ /g, '+');
            const decodedData = JSON.parse(decodeURIComponent(escape(atob(sanitizedBase64))));
            
            const studentIframe = document.getElementById('student-iframe');
            if (decodedData.simType === 'url') {
                studentIframe.src = getEmbeddableUrl(decodedData.simData);
            } else if (decodedData.simType === 'html') {
                studentIframe.srcdoc = decodedData.simData;
            }

            renderStudentQuestions(decodedData.questions);
        } catch (err) {
            console.error("미리보기 데이터 파싱 에러:", err);
            alert("미리보기 데이터를 불러오는 중 오류가 발생했습니다.");
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

            roomData = roomSnap.data();

            const studentIframe = document.getElementById('student-iframe');
            if (roomData.simType === 'url') {
                studentIframe.src = getEmbeddableUrl(roomData.simData);
            } else if (roomData.simType === 'html') {
                studentIframe.srcdoc = roomData.simData;
            }

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

        // Collect answers and attachments
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

        // Check duplicate submission if not in preview mode
        if (mode !== 'preview' && isFirebaseInitialized && db) {
            try {
                const subDocRef = doc(db, "users", teacherId, "rooms", roomId, "submissions", studentId);
                const subSnap = await getDoc(subDocRef);
                if (subSnap.exists()) {
                    const overwrite = confirm(`이미 학번 [${studentId}]으로 제출된 답안이 존재합니다. 기존 답안을 덮어쓰시겠습니까?`);
                    if (!overwrite) {
                        return;
                    }
                }
            } catch (err) {
                console.warn("중복 제출 확인 실패 (진행 중):", err);
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

                feedbackText.innerHTML = `🤖 <strong>[미리보기 모드 AI 피드백]</strong><br><br>학생이 작성한 탐구 결과를 기반으로 한 피드백 예시입니다.<br>실제 서비스 운영 중에는 학생이 제출한 답안에 맞춰 Google Gemini AI(<code>gemini-1.5-flash</code>)가 다정하고 유익한 1~2문장의 발문형 힌트 및 안내를 실시간으로 대답해 주며, 제출된 답안이 Firestore DB에 저장되어 교사 실시간 대시보드에 즉각 반영됩니다.`;
                aiBox.classList.remove('hidden');
                aiBox.scrollIntoView({ behavior: 'smooth' });

                btnText.classList.remove('hidden');
                spinner.classList.add('hidden');
                btnSubmit.disabled = false;

                alert('답안 제출 시뮬레이션이 완료되었습니다! (미리보기 모드)');
            }, 1000);
            return;
        }

        let aiHint = "";
        let functionSuccess = false;

        const canvasElement = document.getElementById('drawing-canvas');
        let drawingImg = null;
        if (canvasElement) {
            drawingImg = canvasElement.toDataURL('image/png');
        }

        try {
            const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
            const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
            const functionUrl = isLocal 
                ? `https://us-central1-${projectId}.cloudfunctions.net/getAiHint` 
                : '/api/getAiHint';

            const response = await fetch(functionUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    teacherId,
                    roomId,
                    studentId,
                    studentName,
                    answers,
                    copyCount,
                    pasteCount,
                    drawingImg
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
            console.warn("Cloud Function API 호출 실패. 로컬 가상 AI 피드백 모드로 전환합니다.", err);
        }

        // Fallback: If Cloud Function call fails (not deployed or network error), generate a local mock AI hint and write directly to Firestore
        if (!functionSuccess) {
            aiHint = `🤖 [로컬 가상 AI 피드백] ${studentName} 학생이 작성한 탐구 결과를 확인했습니다. 제시해주신 관찰 내용과 추론 과정을 기반으로 하여 스스로 어떤 수학/과학적 원리를 더 도출해낼 수 있을지 한 단계만 더 깊게 들어가 연구해 보세요!`;
            
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
                        drawingImg,
                        timestamp: serverTimestamp()
                    };
                    await setDoc(subDocRef, submissionData);
                    functionSuccess = true;
                    console.log("Direct client-side Firestore write succeeded (Cloud Function fallback).");
                } catch (writeErr) {
                    console.error("Direct client-side Firestore write failed:", writeErr);
                    alert("답안 제출 중 오류가 발생했습니다: 파이어베이스 데이터베이스에 연결할 수 없습니다. " + writeErr.message);
                    btnText.classList.remove('hidden');
                    spinner.classList.add('hidden');
                    btnSubmit.disabled = false;
                    return;
                }
            } else {
                alert("답안 제출 실패: 파이어베이스가 연결되지 않은 로컬 오프라인 환경입니다.");
                btnText.classList.remove('hidden');
                spinner.classList.add('hidden');
                btnSubmit.disabled = false;
                return;
            }
        }

        // Update UI with the hint
        const aiBox = document.getElementById('student-ai-box');
        const feedbackText = document.getElementById('student-ai-feedback');

        feedbackText.textContent = aiHint;
        aiBox.classList.remove('hidden');
        aiBox.scrollIntoView({ behavior: 'smooth' });

        if (functionSuccess) {
            alert('답안이 제출되었습니다!');
        }
        
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
        btnSubmit.disabled = false;
    });
});
