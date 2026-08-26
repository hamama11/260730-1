import { db, auth, googleProvider, storage, isFirebaseInitialized } from "./firebaseConfig.js";
import { collection, doc, setDoc, query, where, onSnapshot, deleteDoc, getDocs, getDoc } from "firebase/firestore";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import QRCode from 'qrcode';

// Helper to generate a random secret key
function generateSecretKey(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Generate random ID for custom questions
function generateId() {
    return 'q_' + Math.random().toString(36).substr(2, 9);
}

document.addEventListener('DOMContentLoaded', () => {
    const createRoomForm = document.getElementById('create-room-form');
    if (!createRoomForm) return;

    let currentUser = null;
    let unsubscribeMyRooms = null;
    const urlParams = new URLSearchParams(window.location.search);
    const editRoomId = urlParams.get('edit');
    const editTeacherId = urlParams.get('teacherId') || 'offline';

    // ── Drag & Drop Modal Logic ──
    function makeDraggable(card, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        handle.onmousedown = dragMouseDown;
        handle.ontouchstart = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            if (e.type === 'touchstart') {
                pos3 = e.touches[0].clientX;
                pos4 = e.touches[0].clientY;
            } else {
                e.preventDefault();
                pos3 = e.clientX;
                pos4 = e.clientY;
            }
            document.onmouseup = closeDragElement;
            document.ontouchend = closeDragElement;
            document.onmousemove = elementDrag;
            document.ontouchmove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            let clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
            let clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
            
            pos1 = pos3 - clientX;
            pos2 = pos4 - clientY;
            pos3 = clientX;
            pos4 = clientY;
            
            card.style.position = 'absolute';
            card.style.margin = '0';
            card.style.top = (card.offsetTop - pos2) + "px";
            card.style.left = (card.offsetLeft - pos1) + "px";
        }

        document.addEventListener('mouseup', closeDragElement);
        document.addEventListener('touchend', closeDragElement);

        function closeDragElement() {
            document.onmouseup = null;
            document.ontouchend = null;
            document.onmousemove = null;
            document.ontouchmove = null;
        }
    }

    const classQrModal = document.getElementById('classroom-qr-modal');
    if (classQrModal) {
        const card = classQrModal.querySelector('.draggable-card');
        const handle = classQrModal.querySelector('.drag-handle');
        if (card && handle) {
            makeDraggable(card, handle);
        }
    }

    // ── Help Modal Trigger Logic ──
    const btnOpenHelp = document.getElementById('btn-open-help');
    const helpModal = document.getElementById('help-modal');
    const btnCloseHelp = document.getElementById('btn-close-help');
    const btnCloseHelpConfirm = document.getElementById('btn-close-help-confirm');

    if (btnOpenHelp && helpModal) {
        btnOpenHelp.addEventListener('click', () => {
            helpModal.classList.remove('hidden');
        });
    }

    const hideHelpModal = () => {
        if (helpModal) helpModal.classList.add('hidden');
    };

    if (btnCloseHelp) btnCloseHelp.addEventListener('click', hideHelpModal);
    if (btnCloseHelpConfirm) btnCloseHelpConfirm.addEventListener('click', hideHelpModal);

    // ── Classroom QR Modal close listeners ──
    const qrModal = document.getElementById('classroom-qr-modal');
    const btnCloseQr = document.getElementById('btn-close-qr');
    const btnCloseQrConfirm = document.getElementById('btn-close-qr-confirm');
    const hideQrModal = () => {
        if (qrModal) qrModal.classList.add('hidden');
    };
    if (btnCloseQr) btnCloseQr.addEventListener('click', hideQrModal);
    if (btnCloseQrConfirm) btnCloseQrConfirm.addEventListener('click', hideQrModal);

    // Dynamic CSV Downloader separating answers by question cells
    const downloadRoomCsv = async (roomId, roomData) => {
        try {
            const teacherUid = auth.currentUser ? auth.currentUser.uid : "offline";
            const subCollectionRef = collection(db, "users", teacherUid, "rooms", roomId, "submissions");
            const querySnapshot = await getDocs(subCollectionRef);
            const submissions = [];
            querySnapshot.forEach(doc => {
                submissions.push({ id: doc.id, ...doc.data() });
            });

            if (submissions.length === 0) {
                alert("제출된 학생 답안이 없어 CSV를 다운로드할 수 없습니다.");
                return;
            }

            // Sort submissions by student ID
            submissions.sort((a, b) => {
                const idA = (a.studentId || "").toString().trim();
                const idB = (b.studentId || "").toString().trim();
                return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
            });

            const questions = roomData.questions || [
                { id: 'q_default_a', question: '질문 A. 시뮬레이션에서 관찰한 특징이나 특이점은 무엇인가요?' },
                { id: 'q_default_b', question: '질문 B. 관찰을 통해 추론할 수 있는 수학/과학적 원리는 무엇인가요?' }
            ];

            // Build CSV Header (Splitting by questions)
            const headers = ["학번", "이름"];
            questions.forEach((q, idx) => {
                headers.push(`질문 ${idx + 1}: ${q.question}`);
            });
            headers.push("소요시간(초)", "제출시간");

            const csvRows = [headers.join(",")];

            const escapeCsv = (val) => {
                if (val === null || val === undefined) return "";
                let str = String(val);
                str = str.replace(/"/g, '""');
                if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
                    return `"${str}"`;
                }
                return str;
            };

            submissions.forEach(sub => {
                const timeStr = sub.timestamp ? sub.timestamp.toDate().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "";
                const row = [sub.studentId || "", sub.studentName || ""];

                // Push answers matching each question cell
                questions.forEach(q => {
                    let answerText = "";
                    if (Array.isArray(sub.answers)) {
                        const ansObj = sub.answers.find(a => a.id === q.id);
                        if (ansObj) {
                            answerText = ansObj.answer || "";
                        }
                    } else {
                        // Fallback to default questions
                        if (q.id === 'q_default_a') answerText = sub.answerA || "";
                        else if (q.id === 'q_default_b') answerText = sub.answerB || "";
                    }
                    row.push(answerText);
                });

                const elapsedSecStr = sub.elapsedSeconds !== undefined && sub.elapsedSeconds !== null ? `${sub.elapsedSeconds}초` : "";
                row.push(elapsedSecStr, timeStr);
                csvRows.push(row.map(escapeCsv).join(","));
            });

            const csvContent = "\uFEFF" + csvRows.join("\r\n");
            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `수업결과_${roomId}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("CSV 다운로드 에러:", err);
            alert("CSV 다운로드에 실패했습니다: " + err.message);
        }
    };

    // Subscriptions listener for teacher's classrooms
    function setupMyRoomsListener(uid) {
        if (unsubscribeMyRooms) unsubscribeMyRooms();

        const myRoomsList = document.getElementById('my-rooms-list');
        if (!myRoomsList) return;

        const q = query(collection(db, "users", uid, "rooms"));

        unsubscribeMyRooms = onSnapshot(q, (snapshot) => {
            myRoomsList.innerHTML = '';

            if (snapshot.empty) {
                myRoomsList.innerHTML = `
                    <div style="text-align: center; color: var(--text-secondary); padding: 2.5rem; background: rgba(255,255,255,0.01); border: 1px dashed var(--border-color); border-radius: 16px;">
                         개설한 수업방이 아직 없습니다. 상단 폼을 작성해 첫 번째 수업방을 생성하세요!
                    </div>
                `;
                return;
            }

            const roomsList = [];
            snapshot.forEach((roomDoc) => {
                roomsList.push({ id: roomDoc.id, ...roomDoc.data() });
            });

            // Sort by updatedAt or createdAt desc (newest first)
            roomsList.sort((a, b) => {
                const dateA = a.updatedAt || a.createdAt || { toDate: () => new Date(0) };
                const dateB = b.updatedAt || b.createdAt || { toDate: () => new Date(0) };
                return dateB.toDate().getTime() - dateA.toDate().getTime();
            });

            roomsList.forEach((roomData) => {
                const roomId = roomData.id;
                const createdDate = roomData.createdAt ? roomData.createdAt.toDate().toLocaleDateString('ko-KR') : "-";
                
                const card = document.createElement('div');
                card.className = 'room-manager-card';
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
                        <div>
                            <h4 style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem;">
                                📍 수업방 ID: <code style="color: var(--primary);">${roomId}</code>
                            </h4>
                            <div class="room-meta-info">
                                <span class="room-meta-item">질문 수: <strong>${(roomData.questions || []).length}개</strong></span>
                                <span class="room-meta-item">제출 인원: <strong class="student-count-badge-${roomId}">0명</strong></span>
                                <span class="room-meta-item">생성일: <strong>${createdDate}</strong></span>
                            </div>
                        </div>
                    </div>
                    <div class="room-actions">
                        <button type="button" class="btn btn-secondary btn-enter-room" data-id="${roomId}">🔗 방 입장</button>
                        <button type="button" class="btn btn-secondary btn-show-room-qr" data-id="${roomId}">📱 QR 코드</button>
                        <button type="button" class="btn btn-secondary btn-edit-room" data-id="${roomId}" style="border-color: rgba(99, 102, 241, 0.3); color: #a5b4fc; background: rgba(99, 102, 241, 0.05);">🛠️ 설정 수정</button>
                        <a href="teacherMonitor.html?teacherId=${uid}&id=${roomId}&key=${roomData.secretKey}" class="btn btn-primary" style="display: flex; align-items: center; justify-content: center; text-decoration: none; color: #ffffff;">📊 모니터링</a>
                        <button type="button" class="btn btn-accent btn-download-room-csv" data-id="${roomId}">📥 CSV 다운로드</button>
                        <button type="button" class="btn btn-secondary btn-delete-room" data-id="${roomId}" style="background: rgba(223, 94, 94, 0.1); color: var(--danger); border-color: rgba(223, 94, 94, 0.2); max-width: 140px;">🗑️ 삭제</button>
                    </div>
                `;

                // Real-time listener for the student responses count
                const subsColRef = collection(db, "users", uid, "rooms", roomId, "submissions");
                onSnapshot(subsColRef, (subSnap) => {
                    const countBadge = card.querySelector(`.student-count-badge-${roomId}`);
                    if (countBadge) {
                        countBadge.textContent = `${subSnap.size}명`;
                    }
                });

                // Bind 방 입장 (opens student.html in new tab)
                card.querySelector('.btn-enter-room').addEventListener('click', () => {
                    const studentUrl = `${window.location.origin}/student.html?teacherId=${uid}&id=${roomId}`;
                    window.open(studentUrl, '_blank');
                });

                // Bind QR Code modal trigger
                card.querySelector('.btn-show-room-qr').addEventListener('click', () => {
                    const studentUrl = `${window.location.origin}/student.html?teacherId=${uid}&id=${roomId}`;
                    const qModal = document.getElementById('classroom-qr-modal');
                    const qCanvas = document.getElementById('modal-qr-canvas');
                    const qRoomId = document.getElementById('qr-modal-room-id');
                    
                    if (qModal && qCanvas && qRoomId) {
                        const draggableCard = qModal.querySelector('.draggable-card');
                        if (draggableCard) {
                            draggableCard.style.top = '';
                            draggableCard.style.left = '';
                            draggableCard.style.position = '';
                            draggableCard.style.margin = '';
                        }
                        
                        qRoomId.textContent = roomId;
                        qModal.classList.remove('hidden');
                        QRCode.toCanvas(qCanvas, studentUrl, { width: 280, margin: 1 }, function (error) {
                            if (error) console.error("QR Code generation error:", error);
                        });
                    }
                });

                // Bind room edit
                card.querySelector('.btn-edit-room').addEventListener('click', () => {
                    window.location.href = `index.html?edit=${roomId}&teacherId=${uid}`;
                });

                // Bind CSV download
                card.querySelector('.btn-download-room-csv').addEventListener('click', () => {
                    downloadRoomCsv(roomId, roomData);
                });

                // Bind classroom deletion
                card.querySelector('.btn-delete-room').addEventListener('click', async () => {
                    if (confirm(`이 수업방 (${roomId})과 축적된 모든 학생 제출 데이터가 영구히 삭제됩니다. 정말 삭제하시겠습니까?`)) {
                        try {
                            const subSnapshot = await getDocs(collection(db, "users", uid, "rooms", roomId, "submissions"));
                            for (const subDoc of subSnapshot.docs) {
                                await deleteDoc(doc(db, "users", uid, "rooms", roomId, "submissions", subDoc.id));
                            }
                            await deleteDoc(doc(db, "users", uid, "rooms", roomId));
                            alert("수업방이 정상적으로 삭제되었습니다.");
                        } catch (err) {
                            console.error("수업방 삭제 오류:", err);
                            alert("삭제 중 오류가 발생했습니다: " + err.message);
                        }
                    }
                });

                myRoomsList.appendChild(card);
            });
        });
    }

    // Monitor Auth State
    if (isFirebaseInitialized && auth) {
        onAuthStateChanged(auth, (user) => {
            const btnLogin = document.getElementById('btn-google-login');
            const authStatus = document.getElementById('auth-status');
            const authEmail = document.getElementById('auth-email');
            const authPhoto = document.getElementById('auth-photo');
            const authAvatar = document.getElementById('auth-avatar');

            const authDesc = document.getElementById('auth-desc');
            if (user) {
                currentUser = user;
                authStatus.textContent = `안녕하세요, ${user.displayName || "교사"}님!`;
                authEmail.textContent = `(${user.email})`;
                authEmail.classList.remove('hidden');
                btnLogin.textContent = "로그아웃";

                if (authDesc) authDesc.classList.add('hidden');

                if (user.photoURL) {
                    authPhoto.src = user.photoURL;
                    authPhoto.classList.remove('hidden');
                    authAvatar.classList.add('hidden');
                } else {
                    authPhoto.classList.add('hidden');
                    authAvatar.classList.remove('hidden');
                }

                // Show room creation form and my rooms dashboard section
                createRoomForm.classList.remove('hidden');
                const myRoomsSection = document.getElementById('my-rooms-section');
                if (myRoomsSection) myRoomsSection.classList.remove('hidden');

                setupMyRoomsListener(user.uid);
                checkAndLoadEditMode(user.uid);
            } else {
                currentUser = null;
                authStatus.textContent = "로그인해 주세요.";
                authEmail.textContent = "";
                authEmail.classList.add('hidden');
                authPhoto.classList.add('hidden');
                authAvatar.classList.remove('hidden');
                btnLogin.textContent = "Google 로그인";

                if (authDesc) authDesc.classList.remove('hidden');

                // Hide room creation form and my rooms section
                createRoomForm.classList.add('hidden');
                const myRoomsSection = document.getElementById('my-rooms-section');
                if (myRoomsSection) myRoomsSection.classList.add('hidden');

                if (unsubscribeMyRooms) {
                    unsubscribeMyRooms();
                    unsubscribeMyRooms = null;
                }
            }
        });

        // Add Google Login Button Click Listener
        document.getElementById('btn-google-login').addEventListener('click', async () => {
            if (auth.currentUser) {
                if (confirm("로그아웃 하시겠습니까?")) {
                    await signOut(auth);
                }
            } else {
                try {
                    await signInWithPopup(auth, googleProvider);
                } catch (err) {
                    console.error("Google 로그인 에러:", err);
                    alert("로그인에 실패했습니다: " + err.message);
                }
            }
        });
    } else {
        // Fallback for offline mode
        const authSection = document.getElementById('auth-section');
        if (authSection) authSection.classList.add('hidden');
        createRoomForm.classList.remove('hidden');
        checkAndLoadEditMode('offline');
    }

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    let currentTab = 'tab-url';

    // Default questions configuration setup
    let questions = [
        { 
            id: 'q_default_a', 
            type: 'subjective', 
            question: '질문 A. 시뮬레이션에서 관찰한 특징이나 특이점은 무엇인가요?',
            required: true
        },
        { 
            id: 'q_default_b', 
            type: 'subjective', 
            question: '질문 B. 관찰을 통해 추론할 수 있는 수학/과학적 원리는 무엇인가요?',
            required: true
        }
    ];

    const questionsList = document.getElementById('questions-list');
    const btnAddSubjective = document.getElementById('btn-add-subjective');
    const btnAddObjective = document.getElementById('btn-add-objective');

    // Render questions editor
    function renderQuestionsConfig() {
        questionsList.innerHTML = '';
        if (questions.length === 0) {
            questionsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); margin: 1.5rem 0; font-size: 0.95rem;">등록된 질문이 없습니다. 아래 버튼으로 질문을 추가하세요.</p>';
            return;
        }

        questions.forEach((q, qIndex) => {
            const qDiv = document.createElement('div');
            qDiv.className = 'question-item';
            qDiv.style.background = 'rgba(255, 255, 255, 0.02)';
            qDiv.style.border = '1px solid var(--border-color)';
            qDiv.style.borderRadius = '12px';
            qDiv.style.padding = '1.2rem';
            qDiv.style.marginBottom = '1rem';

            const isRequired = q.required !== false; // default true

            let optionsHtml = '';
            if (q.type === 'objective') {
                const optItems = (q.options || []).map((opt, optIdx) => `
                    <div class="option-config-item" style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center;">
                        <input type="text" class="option-input" value="${opt}" placeholder="선택지 내용을 입력하세요" style="flex:1; padding: 0.5rem 0.8rem;" data-qidx="${qIndex}" data-optidx="${optIdx}">
                        <button type="button" class="btn btn-secondary btn-delete-option" style="padding: 0.4rem 0.8rem; font-size: 1.1rem; line-height: 1;" data-qidx="${qIndex}" data-optidx="${optIdx}">&times;</button>
                    </div>
                `).join('');

                optionsHtml = `
                    <div class="options-config-container" style="margin-top: 0.8rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.4rem;">선택지 구성</label>
                        <div class="options-config-list">
                            ${optItems}
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm btn-add-option" data-qidx="${qIndex}" style="margin-top: 0.5rem; padding: 0.4rem 0.8rem; font-size: 0.8rem;">+ 선택지 추가</button>
                    </div>
                `;
            }

            qDiv.innerHTML = `
                <div class="question-item-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span class="badge ${q.type === 'objective' ? 'badge-accent' : ''}">${q.type === 'objective' ? '객관식' : '주관식'} 질문 #${qIndex + 1}</span>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 0.8rem;">
                        <!-- Google Forms Style Required Toggle Switch -->
                        <label style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--text-primary); cursor: pointer; user-select: none; margin: 0;">
                            <input type="checkbox" class="question-required-toggle" data-index="${qIndex}" ${isRequired ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer;">
                            <span style="font-weight: 600; color: ${isRequired ? 'var(--primary)' : 'var(--text-secondary)'};">필수 ${isRequired ? 'ON' : 'OFF'}</span>
                        </label>
                        <button type="button" class="btn btn-secondary btn-sm btn-delete-question" data-index="${qIndex}" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border-color: rgba(239, 68, 68, 0.2); padding: 0.35rem 0.7rem; font-size: 0.8rem;">질문 삭제</button>
                    </div>
                </div>
                <div class="form-group" style="margin-bottom: 0.5rem;">
                    <label style="font-size: 0.85rem; color: var(--text-secondary);">질문 타이틀</label>
                    <input type="text" class="question-title-input" value="${q.question}" placeholder="예: 시뮬레이션에서 관찰한 특징은 무엇인가요?" style="font-size: 0.95rem;" data-index="${qIndex}">
                </div>
                ${optionsHtml}
            `;
            questionsList.appendChild(qDiv);
        });
    }

    renderQuestionsConfig();

    // Add Question listeners
    btnAddSubjective.addEventListener('click', () => {
        questions.push({
            id: generateId(),
            type: 'subjective',
            question: '',
            required: true
        });
        renderQuestionsConfig();
    });

    btnAddObjective.addEventListener('click', () => {
        questions.push({
            id: generateId(),
            type: 'objective',
            question: '',
            options: ['옵션 1', '옵션 2'],
            required: true
        });
        renderQuestionsConfig();
    });

    // Delegate actions inside questionsList
    questionsList.addEventListener('input', (e) => {
        if (e.target.classList.contains('question-title-input')) {
            const qIdx = parseInt(e.target.dataset.index);
            questions[qIdx].question = e.target.value;
        }
        if (e.target.classList.contains('option-input')) {
            const qIdx = parseInt(e.target.dataset.qidx);
            const optIdx = parseInt(e.target.dataset.optidx);
            questions[qIdx].options[optIdx] = e.target.value;
        }
    });

    questionsList.addEventListener('change', (e) => {
        if (e.target.classList.contains('question-required-toggle')) {
            const qIdx = parseInt(e.target.dataset.index);
            questions[qIdx].required = e.target.checked;
            renderQuestionsConfig();
        }
    });

    questionsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-delete-question')) {
            const index = parseInt(e.target.dataset.index);
            questions.splice(index, 1);
            renderQuestionsConfig();
        }
        if (e.target.classList.contains('btn-add-option')) {
            const qIdx = parseInt(e.target.dataset.qidx);
            questions[qIdx].options.push(`옵션 ${questions[qIdx].options.length + 1}`);
            renderQuestionsConfig();
        }
        if (e.target.classList.contains('btn-delete-option')) {
            const qIdx = parseInt(e.target.dataset.qidx);
            const optIdx = parseInt(e.target.dataset.optidx);
            questions[qIdx].options.splice(optIdx, 1);
            renderQuestionsConfig();
        }
    });

    // ── Mealkit Files & Layout State ──
    let mealkitFiles = []; // Array of { id, name, size, type, fileObject, label, url, storagePath }
    let selectedLayout = 'tab'; // 'tab' | 'split' | 'scroll'
    let replaceTargetId = null;

    const mealkitDropzone = document.getElementById('mealkit-dropzone');
    const mealkitFileInput = document.getElementById('mealkit-file-input');
    const mealkitDropzoneText = document.getElementById('mealkit-dropzone-text');
    const mealkitFilesContainer = document.getElementById('mealkit-files-container');
    const mealkitFilesList = document.getElementById('mealkit-files-list');
    const mealkitFilesCount = document.getElementById('mealkit-files-count');
    const layoutModeWarning = document.getElementById('layout-mode-warning');

    // URL link elements
    const mealkitUrlInput = document.getElementById('mealkit-url-input');
    const btnMealkitAddUrl = document.getElementById('btn-mealkit-add-url');

    // Layout buttons
    const layoutSelector = document.getElementById('layout-mode-selector');
    const layoutBtns = layoutSelector ? layoutSelector.querySelectorAll('.tab-btn') : [];
    const btnLayoutSplit = document.getElementById('btn-layout-split');

    // Handle Layout Selection clicks
    layoutBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.layout;
            if (mode === 'split' && mealkitFiles.length >= 4) {
                alert("자료가 4개 이상일 때는 다단 분할 모드를 선택할 수 없습니다.");
                return;
            }
            layoutBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedLayout = mode;
        });
    });

    // Auto-validate and update Layout options based on file count
    function updateLayoutAvailability() {
        if (mealkitFiles.length >= 4) {
            if (btnLayoutSplit) {
                btnLayoutSplit.style.opacity = '0.4';
                btnLayoutSplit.style.cursor = 'not-allowed';
            }
            if (layoutModeWarning) layoutModeWarning.style.display = 'block';

            if (selectedLayout === 'split') {
                selectedLayout = 'tab';
                layoutBtns.forEach(b => {
                    b.classList.remove('active');
                    if (b.dataset.layout === 'tab') b.classList.add('active');
                });
            }
        } else {
            if (btnLayoutSplit) {
                btnLayoutSplit.style.opacity = '1';
                btnLayoutSplit.style.cursor = 'pointer';
            }
            if (layoutModeWarning) layoutModeWarning.style.display = 'none';
        }
    }

    async function checkAndLoadEditMode(uid) {
        if (!editRoomId) return;
        if (editTeacherId !== uid) {
            console.warn("Edit uid mismatch. Logged in uid:", uid, "URL teacherId:", editTeacherId);
            return;
        }

        try {
            if (!isFirebaseInitialized || !db) return;
            const roomRef = doc(db, "users", editTeacherId, "rooms", editRoomId);
            const roomSnap = await getDoc(roomRef);
            if (roomSnap.exists()) {
                const roomData = roomSnap.data();
                
                // 1. Populate mealkitFiles list
                mealkitFiles = (roomData.files || []).map(f => ({
                    id: f.id,
                    name: f.name,
                    size: f.size || 0,
                    type: f.type || (f.name.toLowerCase().endsWith('.html') ? 'html' : (f.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image')),
                    fileObject: null, 
                    label: f.label || f.name,
                    url: f.url,
                    storagePath: f.storagePath || ''
                }));

                // 2. Populate questions
                questions = roomData.questions || [];

                // 3. Populate selectedLayout
                selectedLayout = roomData.layoutMode || 'tab';

                // 4. Update UI: Canvas Option Radio
                const canvasIndependent = document.querySelector('input[name="canvas-option"][value="independent"]');
                const canvasGlobal = document.querySelector('input[name="canvas-option"][value="global"]');
                if (roomData.globalCanvas) {
                    if (canvasGlobal) canvasGlobal.checked = true;
                } else {
                    if (canvasIndependent) canvasIndependent.checked = true;
                }

                // 4-2. Update UI: Time Tracking Checkbox
                const checkTimeTracking = document.getElementById('check-time-tracking');
                if (checkTimeTracking) {
                    checkTimeTracking.checked = roomData.enableTimeTracking !== false;
                }

                // 5. Update UI: Layout Buttons active state
                if (layoutBtns) {
                    layoutBtns.forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.layout === selectedLayout);
                    });
                }

                // 6. Update UI: Room ID input (Disable it)
                const customRoomIdInput = document.getElementById('custom-room-id');
                if (customRoomIdInput) {
                    customRoomIdInput.value = editRoomId;
                    customRoomIdInput.disabled = true;
                }

                // 7. Update UI: Submit Button Text
                const btnCreateRoom = document.getElementById('btn-create-room');
                if (btnCreateRoom) {
                    const btnText = btnCreateRoom.querySelector('.btn-text');
                    if (btnText) btnText.textContent = '🛠️ 수업 밀키트 수정 완료';
                }

                // Render lists
                renderMealkitFilesList();
                renderQuestionsConfig();

                console.log("Room settings loaded for editing:", editRoomId);
            }
        } catch (err) {
            console.error("수업방 수정 정보 불러오기 실패:", err);
        }
    }

    // Render Uploaded Files & URLs
    function renderMealkitFilesList() {
        if (!mealkitFilesList) return;
        mealkitFilesList.innerHTML = '';

        if (mealkitFiles.length === 0) {
            if (mealkitFilesContainer) mealkitFilesContainer.classList.add('hidden');
            if (mealkitFilesCount) mealkitFilesCount.textContent = '0';
            updateLayoutAvailability();
            return;
        }

        if (mealkitFilesContainer) mealkitFilesContainer.classList.remove('hidden');
        if (mealkitFilesCount) mealkitFilesCount.textContent = mealkitFiles.length;

        mealkitFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 1rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.6rem 0.9rem; flex-wrap: wrap;';

            // Extension icon or link icon
            let icon = '📄';
            let subtitle = '';

            if (file.type === 'url') {
                icon = '🌐';
                subtitle = file.url;
            } else if (file.type === 'blank') {
                icon = '📄';
                subtitle = '자유 화이트보드 (판서용)';
            } else if (file.type === 'coordinate') {
                icon = '📐';
                subtitle = '좌표평면 (수학 격자 판서용)';
            } else {
                if (file.name.toLowerCase().endsWith('.pdf')) icon = '📕';
                else if (file.name.toLowerCase().endsWith('.html')) icon = '💻';
                else if (/\.(png|jpg|jpeg|webp)$/i.test(file.name)) icon = '🖼️';
                subtitle = `${(file.size / 1024).toFixed(1)} KB`;
            }

            const infoArea = document.createElement('div');
            infoArea.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 220px; max-width: 320px; overflow: hidden;';
            infoArea.innerHTML = `
                <span style="font-size: 1.2rem;">${icon}</span>
                <div style="display: flex; flex-direction: column; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: calc(100% - 2rem);">
                    <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden;">${file.name}</span>
                    <span style="font-size: 0.7rem; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden;">${subtitle}</span>
                </div>
            `;

            // Tab label editor input
            const labelGroup = document.createElement('div');
            labelGroup.style.cssText = 'display: flex; align-items: center; gap: 0.4rem; min-width: 160px; flex: 1;';
            labelGroup.innerHTML = `
                <span style="font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap;">탭 이름:</span>
                <input type="text" value="${file.label}" style="padding: 0.35rem 0.6rem; font-size: 0.8rem; border-radius: 6px; border: 1px solid var(--border-color); width: 100%; color: var(--text-primary); background: rgba(15,23,42,0.4);" placeholder="탭 표시 이름">
            `;
            const labelInput = labelGroup.querySelector('input');
            labelInput.addEventListener('input', (e) => {
                file.label = e.target.value.trim() || file.name;
            });

            // Action buttons (Reorder Up/Down & Delete/Edit)
            const actions = document.createElement('div');
            actions.style.cssText = 'display: flex; gap: 0.35rem; align-items: center;';

            // Reorder buttons
            const reorderGroup = document.createElement('div');
            reorderGroup.style.cssText = 'display: flex; gap: 0.2rem; margin-right: 0.3rem;';
            reorderGroup.innerHTML = `
                <button type="button" class="btn btn-secondary btn-sm btn-move-up" style="padding: 0.35rem 0.55rem; font-size: 0.8rem; line-height: 1;" title="순서 위로" ${index === 0 ? 'disabled' : ''}>▲</button>
                <button type="button" class="btn btn-secondary btn-sm btn-move-down" style="padding: 0.35rem 0.55rem; font-size: 0.8rem; line-height: 1;" title="순서 아래로" ${index === mealkitFiles.length - 1 ? 'disabled' : ''}>▼</button>
            `;

            reorderGroup.querySelector('.btn-move-up').addEventListener('click', () => {
                if (index > 0) {
                    const temp = mealkitFiles[index];
                    mealkitFiles[index] = mealkitFiles[index - 1];
                    mealkitFiles[index - 1] = temp;
                    renderMealkitFilesList();
                }
            });

            reorderGroup.querySelector('.btn-move-down').addEventListener('click', () => {
                if (index < mealkitFiles.length - 1) {
                    const temp = mealkitFiles[index];
                    mealkitFiles[index] = mealkitFiles[index + 1];
                    mealkitFiles[index + 1] = temp;
                    renderMealkitFilesList();
                }
            });

            actions.appendChild(reorderGroup);

            if (file.type === 'url') {
                const actionBtns = document.createElement('div');
                actionBtns.style.cssText = 'display: flex; gap: 0.35rem;';
                actionBtns.innerHTML = `
                    <button type="button" class="btn btn-secondary btn-sm btn-edit-url" style="padding: 0.35rem 0.7rem; font-size: 0.75rem; border-color: rgba(99, 102, 241, 0.3); color: #a5b4fc; background: rgba(99, 102, 241, 0.05);">✏️ URL 수정</button>
                    <button type="button" class="btn btn-secondary btn-sm" style="padding: 0.35rem 0.7rem; font-size: 0.75rem; border-color: rgba(239, 68, 68, 0.2); color: #f87171; background: rgba(239, 68, 68, 0.05);">🗑️ 삭제</button>
                `;

                // URL modify handler
                actionBtns.querySelector('.btn-edit-url').addEventListener('click', () => {
                    const newUrl = prompt("수정할 외부 웹사이트/시뮬레이션 주소(URL)를 입력해 주세요:", file.url);
                    if (newUrl !== null && newUrl.trim()) {
                        file.url = newUrl.trim();
                        file.name = newUrl.trim();
                        try {
                            const urlObj = new URL(file.url);
                            file.label = urlObj.hostname.replace('www.', '');
                        } catch (e) {
                            file.label = '웹 링크';
                        }
                        renderMealkitFilesList();
                    }
                });

                // Delete URL handler
                actionBtns.querySelectorAll('button')[1].addEventListener('click', () => {
                    if (confirm(`'${file.label}' 링크를 목록에서 삭제하시겠습니까?`)) {
                        mealkitFiles.splice(index, 1);
                        renderMealkitFilesList();
                    }
                });
                actions.appendChild(actionBtns);
            } else if (file.type === 'blank' || file.type === 'coordinate') {
                const actionBtns = document.createElement('div');
                actionBtns.style.cssText = 'display: flex; gap: 0.35rem;';
                actionBtns.innerHTML = `
                    <button type="button" class="btn btn-secondary btn-sm" style="padding: 0.35rem 0.7rem; font-size: 0.75rem; border-color: rgba(239, 68, 68, 0.2); color: #f87171; background: rgba(239, 68, 68, 0.05);">🗑️ 삭제</button>
                `;
                actionBtns.querySelector('button').addEventListener('click', () => {
                    if (confirm(`'${file.label}' 탭을 목록에서 제외하시겠습니까?`)) {
                        mealkitFiles.splice(index, 1);
                        renderMealkitFilesList();
                    }
                });
                actions.appendChild(actionBtns);
            } else {
                const actionBtns = document.createElement('div');
                actionBtns.style.cssText = 'display: flex; gap: 0.35rem;';
                actionBtns.innerHTML = `
                    <button type="button" class="btn btn-secondary btn-sm btn-replace-file" style="padding: 0.35rem 0.7rem; font-size: 0.75rem; border-color: rgba(99, 102, 241, 0.3); color: #a5b4fc; background: rgba(99, 102, 241, 0.05);">🔄 교체</button>
                    <button type="button" class="btn btn-secondary btn-sm" style="padding: 0.35rem 0.7rem; font-size: 0.75rem; border-color: rgba(239, 68, 68, 0.2); color: #f87171; background: rgba(239, 68, 68, 0.05);">🗑️ 삭제</button>
                `;

                // Replace handler
                actionBtns.querySelector('.btn-replace-file').addEventListener('click', () => {
                    replaceTargetId = file.id;
                    if (mealkitFileInput) mealkitFileInput.click();
                });

                // Delete handler
                actionBtns.querySelectorAll('button')[1].addEventListener('click', async () => {
                    if (confirm(`'${file.name}' 파일을 수업 목록에서 제외하시겠습니까?`)) {
                        if (file.storagePath && isFirebaseInitialized && storage) {
                            try {
                                const fileRef = ref(storage, file.storagePath);
                                await deleteObject(fileRef);
                                console.log("Firebase Storage asset deleted:", file.storagePath);
                            } catch (err) {
                                console.warn("Storage deletion error (non-fatal):", err);
                            }
                        }
                        mealkitFiles.splice(index, 1);
                        renderMealkitFilesList();
                    }
                });
                actions.appendChild(actionBtns);
            }

            item.appendChild(infoArea);
            item.appendChild(labelGroup);
            item.appendChild(actions);
            mealkitFilesList.appendChild(item);
        });

        updateLayoutAvailability();
    }

    // File selection validation & adding logic
    function processSelectedFiles(filesList) {
        if (!filesList || filesList.length === 0) return;

        const allowedExtensions = ['.html', '.pdf', '.png', '.jpg', '.jpeg', '.webp'];

        for (let i = 0; i < filesList.length; i++) {
            const file = filesList[i];
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

            if (!allowedExtensions.includes(ext)) {
                alert(`지원되지 않는 확장자입니다: ${file.name}\n(.html, .pdf, .png, .jpg, .jpeg, .webp 파일만 지원합니다)`);
                continue;
            }

            // Individual size check
            if (ext === '.pdf' && file.size > 10 * 1024 * 1024) {
                alert(`PDF 파일의 최대 허용 크기는 10MB입니다: ${file.name}`);
                continue;
            } else if (ext !== '.pdf' && file.size > 5 * 1024 * 1024) {
                alert(`HTML/이미지 파일의 최대 허용 크기는 5MB입니다: ${file.name}`);
                continue;
            }

            // Total size check
            const currentTotalSize = mealkitFiles.reduce((sum, f) => f.type !== 'url' ? sum + f.size : sum, 0);
            if (currentTotalSize + file.size > 30 * 1024 * 1024) {
                alert(`전체 파일의 합계 용량이 30MB를 초과하여 추가할 수 없습니다: ${file.name}`);
                break;
            }

            // Default label: screenshot or filename without extension
            let defaultLabel = file.name.substring(0, file.name.lastIndexOf('.'));
            if (file.name.startsWith('screenshot_')) {
                const screenshotNum = mealkitFiles.filter(f => f.name.startsWith('screenshot_')).length + 1;
                defaultLabel = `스크린샷_${screenshotNum}`;
            }

            if (replaceTargetId) {
                // Perform file replacement
                const targetIdx = mealkitFiles.findIndex(f => f.id === replaceTargetId);
                if (targetIdx !== -1) {
                    const prevFile = mealkitFiles[targetIdx];
                    if (prevFile.storagePath && isFirebaseInitialized && storage) {
                        try {
                            const fileRef = ref(storage, prevFile.storagePath);
                            deleteObject(fileRef);
                        } catch (err) {
                            console.warn("Storage deletion error during replace:", err);
                        }
                    }
                    mealkitFiles[targetIdx] = {
                        id: prevFile.id,
                        name: file.name,
                        size: file.size,
                        type: ext,
                        fileObject: file,
                        label: prevFile.label, // maintain label
                        url: '',
                        storagePath: ''
                    };
                }
                replaceTargetId = null;
                break;
            } else {
                if (mealkitFiles.length >= 10) {
                    alert("자료는 최대 10개까지만 등록할 수 있습니다.");
                    break;
                }
                mealkitFiles.push({
                    id: generateId(),
                    name: file.name,
                    size: file.size,
                    type: ext,
                    fileObject: file,
                    label: defaultLabel,
                    url: '',
                    storagePath: ''
                });
            }
        }

        renderMealkitFilesList();
        if (mealkitFileInput) mealkitFileInput.value = '';
    }

    // Bind URL Link Add
    if (btnMealkitAddUrl && mealkitUrlInput) {
        btnMealkitAddUrl.addEventListener('click', () => {
            const urlVal = mealkitUrlInput.value.trim();
            if (!urlVal) {
                alert("웹 링크 주소를 입력해 주세요.");
                return;
            }
            if (!urlVal.startsWith('http://') && !urlVal.startsWith('https://')) {
                alert("올바른 웹 주소 형식이 아닙니다. http:// 또는 https:// 포함 주소 전체를 입력해 주세요.");
                return;
            }

            if (mealkitFiles.length >= 10) {
                alert("자료는 최대 10개까지만 등록할 수 있습니다.");
                return;
            }

            // Extract domain name for default label
            let domainLabel = '웹 링크';
            try {
                const urlObj = new URL(urlVal);
                domainLabel = urlObj.hostname.replace('www.', '');
            } catch (e) {
                const linkNum = mealkitFiles.filter(f => f.type === 'url').length + 1;
                domainLabel = `웹 링크 ${linkNum}`;
            }

            mealkitFiles.push({
                id: generateId(),
                name: urlVal,
                size: 0,
                type: 'url',
                fileObject: null,
                label: domainLabel,
                url: urlVal,
                storagePath: ''
            });

            mealkitUrlInput.value = '';
            renderMealkitFilesList();
        });
    }

    // Bind Blank & Coordinate Tab Quick Adders
    const btnAddBlankTab = document.getElementById('btn-add-blank-tab');
    if (btnAddBlankTab) {
        btnAddBlankTab.addEventListener('click', () => {
            if (mealkitFiles.length >= 10) {
                alert("자료는 최대 10개까지만 등록할 수 있습니다.");
                return;
            }
            const count = mealkitFiles.filter(f => f.type === 'blank').length + 1;
            const tabName = `화이트보드 ${count}`;
            mealkitFiles.push({
                id: generateId(),
                name: tabName,
                size: 0,
                type: 'blank',
                fileObject: null,
                label: tabName,
                url: '',
                storagePath: ''
            });
            renderMealkitFilesList();
        });
    }

    const btnAddCoordTab = document.getElementById('btn-add-coord-tab');
    if (btnAddCoordTab) {
        btnAddCoordTab.addEventListener('click', () => {
            if (mealkitFiles.length >= 10) {
                alert("자료는 최대 10개까지만 등록할 수 있습니다.");
                return;
            }
            const count = mealkitFiles.filter(f => f.type === 'coordinate').length + 1;
            const tabName = `좌표평면 ${count}`;
            mealkitFiles.push({
                id: generateId(),
                name: tabName,
                size: 0,
                type: 'coordinate',
                fileObject: null,
                label: tabName,
                url: '',
                storagePath: ''
            });
            renderMealkitFilesList();
        });
    }

    // Bind Clipboard Paste (Ctrl+V) for Screenshots
    document.addEventListener('paste', (e) => {
        // Only trigger if focus is not in textarea/input
        const activeTag = document.activeElement.tagName.toLowerCase();
        if (activeTag === 'textarea' || (activeTag === 'input' && document.activeElement.type !== 'file')) {
            return; 
        }

        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                const screenshotFile = new File([blob], `screenshot_${Date.now()}.png`, { type: blob.type });
                processSelectedFiles([screenshotFile]);
                console.log("Clipboard screenshot converted and added to mealkit list.");
            }
        }
    });

    // Bind mealkit Dropzone
    if (mealkitDropzone && mealkitFileInput) {
        mealkitDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            mealkitDropzone.style.backgroundColor = 'rgba(224, 122, 95, 0.08)';
            mealkitDropzone.style.borderColor = 'var(--primary)';
        });

        mealkitDropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            mealkitDropzone.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
            mealkitDropzone.style.borderColor = 'var(--border-color)';
        });

        mealkitDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            mealkitDropzone.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
            mealkitDropzone.style.borderColor = 'var(--border-color)';
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                processSelectedFiles(e.dataTransfer.files);
            }
        });

        mealkitDropzone.addEventListener('click', () => {
            mealkitFileInput.click();
        });

        mealkitFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                processSelectedFiles(e.target.files);
            }
        });
    }

    // Create Room Submit
    createRoomForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (mealkitFiles.length === 0) {
            alert("최소 한 개 이상의 수업 자료를 등록해 주세요.");
            return;
        }

        if (!isFirebaseInitialized || !db || !storage) {
            console.error("수업방 생성 실패: Firebase가 초기화되지 않았습니다.", {
                isFirebaseInitialized,
                db,
                storage
            });
            alert("Firebase 연동에 실패하여 수업방을 만들 수 없습니다.");
            return;
        }

        const customRoomIdInput = document.getElementById('custom-room-id');
        const roomId = customRoomIdInput ? customRoomIdInput.value.trim() : "";
        const cleanRoomId = roomId.replace(/[^a-zA-Z0-9-]/g, '');

        if (!roomId) {
            alert("수업방 고유 ID를 입력해 주세요.");
            return;
        }
        if (cleanRoomId !== roomId) {
            alert("수업방 고유 ID는 영문, 숫자, 하이픈(-)만 사용할 수 있습니다.");
            return;
        }

        const teacherUid = auth.currentUser ? auth.currentUser.uid : "offline";
        const newRoomRef = doc(db, "users", teacherUid, "rooms", roomId);

        try {
            const checkDoc = await getDoc(newRoomRef);
            if (checkDoc.exists()) {
                if (!editRoomId) {
                    const overwrite = confirm("이미 동일한 수업방 ID가 존재합니다. 설정을 덮어쓰시겠습니까?");
                    if (!overwrite) return;
                }
            }
        } catch (err) {
            console.warn("중복 ID 조회 실패:", err);
        }

        // Validate questions
        for (let i = 0; i < questions.length; i++) {
            if (!questions[i].question.trim()) {
                alert(`질문 #${i + 1}의 질문 타이틀을 입력하세요.`);
                return;
            }
            if (questions[i].type === 'objective' && (!questions[i].options || questions[i].options.length === 0)) {
                alert(`객관식 질문 #${i + 1}에는 최소 한 개 이상의 선택지가 필요합니다.`);
                return;
            }
        }

        const btnCreateRoom = document.getElementById('btn-create-room');
        const btnText = btnCreateRoom.querySelector('.btn-text');
        const spinner = btnCreateRoom.querySelector('.spinner');

        // Show cute loader modal
        const cuteLoader = document.getElementById('cute-loader-modal');
        const progressFill = cuteLoader ? cuteLoader.querySelector('.cute-progress-fill') : null;
        if (cuteLoader) {
            cuteLoader.classList.remove('hidden');
            if (progressFill) {
                progressFill.style.animation = 'none';
                progressFill.offsetHeight;
                progressFill.style.animation = 'fillCuteProgress 6s forwards linear';
            }
        }

        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');
        btnCreateRoom.disabled = true;

        try {
            // Upload files & link URLs
            const finalFilesList = [];
            for (let i = 0; i < mealkitFiles.length; i++) {
                const file = mealkitFiles[i];

                if (file.type === 'url') {
                    finalFilesList.push({
                        id: file.id,
                        name: file.name,
                        label: file.label,
                        type: 'url',
                        url: file.url,
                        storagePath: ''
                    });
                } else if (file.type === 'blank' || file.type === 'coordinate') {
                    finalFilesList.push({
                        id: file.id,
                        name: file.name,
                        label: file.label,
                        type: file.type,
                        url: '',
                        storagePath: ''
                    });
                } else if (file.url) {
                    // Already uploaded
                    finalFilesList.push({
                        id: file.id,
                        name: file.name,
                        label: file.label,
                        type: file.name.toLowerCase().endsWith('.html') ? 'html' : (file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'),
                        url: file.url,
                        storagePath: file.storagePath
                    });
                } else {
                    const storagePath = `mealkits/${roomId}/${file.id}_${file.name}`;
                    const fileRef = ref(storage, storagePath);
                    await uploadBytes(fileRef, file.fileObject);
                    const downloadUrl = await getDownloadURL(fileRef);

                    file.url = downloadUrl;
                    file.storagePath = storagePath;

                    finalFilesList.push({
                        id: file.id,
                        name: file.name,
                        label: file.label,
                        type: file.name.toLowerCase().endsWith('.html') ? 'html' : (file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'),
                        url: downloadUrl,
                        storagePath: storagePath
                    });
                }
            }

            const canvasOptionEl = document.querySelector('input[name="canvas-option"]:checked');
            const globalCanvas = canvasOptionEl ? (canvasOptionEl.value === 'global') : false;

            // Maintain original secretKey and createdAt if editing
            let existingRoomData = {};
            if (editRoomId) {
                try {
                    const snap = await getDoc(newRoomRef);
                    if (snap.exists()) {
                        existingRoomData = snap.data();
                    }
                } catch (e) {
                    console.warn("Error fetching existing room metadata:", e);
                }
            }

            const secretKey = existingRoomData.secretKey || ('sec_' + generateSecretKey(16));

            const checkTimeTrackingEl = document.getElementById('check-time-tracking');
            const enableTimeTracking = checkTimeTrackingEl ? checkTimeTrackingEl.checked : true;

            const roomData = {
                files: finalFilesList,
                layoutMode: selectedLayout,
                globalCanvas: globalCanvas,
                enableTimeTracking: enableTimeTracking,
                secretKey: secretKey,
                questions: questions,
                ownerUid: teacherUid,
                createdAt: existingRoomData.createdAt || new Date(),
                updatedAt: new Date()
            };

            await setDoc(newRoomRef, roomData);

            const origin = window.location.origin;
            const studentLink = `${origin}/student.html?teacherId=${teacherUid}&id=${roomId}`;
            const dashboardLink = `${origin}/teacherMonitor.html?teacherId=${teacherUid}&id=${roomId}&key=${secretKey}`;

            document.getElementById('student-link-input').value = studentLink;
            document.getElementById('dashboard-link-input').value = dashboardLink;

            // Bind links
            const btnEnterStudent = document.getElementById('btn-enter-student');
            const btnEnterDashboard = document.getElementById('btn-enter-dashboard');
            if (btnEnterStudent) {
                const newBtn = btnEnterStudent.cloneNode(true);
                btnEnterStudent.parentNode.replaceChild(newBtn, btnEnterStudent);
                newBtn.addEventListener('click', () => { window.open(studentLink, '_blank'); });
            }
            if (btnEnterDashboard) {
                const newBtn = btnEnterDashboard.cloneNode(true);
                btnEnterDashboard.parentNode.replaceChild(newBtn, btnEnterDashboard);
                newBtn.addEventListener('click', () => { window.open(dashboardLink, '_blank'); });
            }

            const canvas = document.getElementById('qr-canvas');
            if (canvas) {
                QRCode.toCanvas(canvas, studentLink, { width: 280, margin: 1 }, function (error) {
                    if (error) console.error("QR Code generation error:", error);
                });
            }

            const shareBox = document.getElementById('created-links-box');
            shareBox.classList.remove('hidden');
            shareBox.scrollIntoView({ behavior: 'smooth' });

            alert("수업 밀키트가 성공적으로 배포되었습니다!");

        } catch (err) {
            console.error("밀키트 배포 에러:", err);
            alert("밀키트를 배포하는 도중 오류가 발생했습니다: " + err.message);
        } finally {
            if (cuteLoader) cuteLoader.classList.add('hidden');
            btnText.classList.remove('hidden');
            spinner.classList.add('hidden');
            btnCreateRoom.disabled = false;
        }
    });

    // Copy handlers
    document.getElementById('btn-copy-student').addEventListener('click', () => {
        const input = document.getElementById('student-link-input');
        input.select();
        document.execCommand('copy');
        alert('학생 접속 링크가 복사되었습니다!');
    });

    document.getElementById('btn-copy-dashboard').addEventListener('click', () => {
        const input = document.getElementById('dashboard-link-input');
        input.select();
        document.execCommand('copy');
        alert('교사 모니터링 링크가 복사되었습니다! (유출에 주의하세요)');
    });

    // Preview click handler
    const btnPreview = document.getElementById('btn-preview');
    if (btnPreview) {
        btnPreview.addEventListener('click', async () => {
            if (mealkitFiles.length === 0) {
                alert("미리보기를 하기 전에 자료를 1개 이상 추가해 주세요.");
                return;
            }
            for (let i = 0; i < questions.length; i++) {
                if (!questions[i].question.trim()) {
                    alert(`질문 #${i + 1}의 질문 타이틀을 입력하세요.`);
                    return;
                }
            }

            // Convert local files to data urls for client preview
            const tempFilesList = [];
            for (let i = 0; i < mealkitFiles.length; i++) {
                const file = mealkitFiles[i];
                let fileDataUrl = '';

                if (file.type === 'url') {
                    fileDataUrl = file.url;
                } else if (file.type === 'blank' || file.type === 'coordinate') {
                    fileDataUrl = '';
                } else if (file.url) {
                    fileDataUrl = file.url;
                } else if (file.fileObject) {
                    fileDataUrl = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.readAsDataURL(file.fileObject);
                    });
                }

                tempFilesList.push({
                    id: file.id,
                    name: file.name,
                    label: file.label,
                    type: file.type,
                    url: fileDataUrl
                });
            }

            const canvasOptionEl = document.querySelector('input[name="canvas-option"]:checked');
            const globalCanvas = canvasOptionEl ? (canvasOptionEl.value === 'global') : false;

            const previewData = {
                files: tempFilesList,
                layoutMode: selectedLayout,
                globalCanvas: globalCanvas,
                questions: questions
            };

            const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(previewData))));
            window.open(`student.html?mode=preview&data=${encodeURIComponent(encodedData)}`, '_blank');
        });
    }
});
