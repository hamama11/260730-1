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

    // ── 2-Tier Tabs Structure State ──
    // Array of Tab objects:
    // {
    //    id: 'tab_xxx',
    //    title: '1단원 탐구',
    //    layout: 'split' | 'scroll',
    //    items: [
    //       { id: 'item_xxx', name: '...', type: 'url'|'html'|'pdf'|'image'|'blank'|'coordinate', url: '...', fileObject: File, storagePath: '...' }
    //    ]
    // }
    let tabsList = [
        {
            id: 'tab_' + Math.random().toString(36).substr(2, 9),
            title: '탐구 활동 1',
            layout: 'split',
            items: []
        }
    ];

    let selectedTabId = tabsList[0].id;

    const tabsStructureContainer = document.getElementById('tabs-structure-container');
    const btnAddNewTab = document.getElementById('btn-add-new-tab');
    const mealkitDropzone = document.getElementById('mealkit-dropzone');
    const mealkitFileInput = document.getElementById('mealkit-file-input');

    if (btnAddNewTab) {
        btnAddNewTab.addEventListener('click', () => {
            if (tabsList.length >= 10) {
                alert("상단 탭은 최대 10개까지만 생성할 수 있습니다.");
                return;
            }
            const tabNum = tabsList.length + 1;
            const newTab = {
                id: 'tab_' + Math.random().toString(36).substr(2, 9),
                title: `탐구 활동 ${tabNum}`,
                layout: 'split',
                items: []
            };
            tabsList.push(newTab);
            selectedTabId = newTab.id; // automatically focus new tab
            renderTabsStructure();
        });
    }

    function renderTabsStructure() {
        if (!tabsStructureContainer) return;
        tabsStructureContainer.innerHTML = '';

        if (tabsList.length === 0) {
            tabsStructureContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 1.5rem; border: 1px dashed var(--border-color); border-radius: 12px;">생성된 탭이 없습니다. [➕ 새 탭 추가] 버튼을 눌러주세요.</p>';
            return;
        }

        // Ensure selectedTabId exists
        if (!tabsList.some(t => t.id === selectedTabId)) {
            selectedTabId = tabsList[0].id;
        }

        tabsList.forEach((tab, tabIdx) => {
            const isSelected = (tab.id === selectedTabId);
            const tabCard = document.createElement('div');
            tabCard.className = 'tab-config-card' + (isSelected ? ' active-selected-tab' : '');
            tabCard.dataset.tabid = tab.id;
            
            // Dynamic card border style for active/focused tab
            const borderStyle = isSelected 
                ? 'border: 2px solid var(--primary); box-shadow: 0 0 16px rgba(224, 122, 95, 0.18); background: rgba(224, 122, 95, 0.025);'
                : 'border: 1px solid var(--border-color); background: rgba(255,255,255,0.02);';

            tabCard.style.cssText = `${borderStyle} border-radius: 14px; padding: 1.2rem; display: flex; flex-direction: column; gap: 1rem; transition: all 0.2s ease; position: relative;`;

            // Click tab card to select/focus for paste
            tabCard.addEventListener('click', (e) => {
                if (['INPUT', 'BUTTON', 'SELECT', 'A'].includes(e.target.tagName)) return;
                if (selectedTabId !== tab.id) {
                    selectedTabId = tab.id;
                    renderTabsStructure();
                }
            });

            // Tab Header Controls
            const tabHeader = document.createElement('div');
            tabHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.9rem;';

            tabHeader.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 320px;">
                    <span style="font-weight: 700; color: var(--primary); font-size: 1.05rem; white-space: nowrap; display: flex; align-items: center; gap: 0.4rem;">
                        📑 탭 #${tabIdx + 1} ${isSelected ? '<span style="font-size: 0.75rem; background: var(--primary); color: white; padding: 0.2rem 0.5rem; border-radius: 6px; font-weight: 600;">선택됨 (Ctrl+V 대상)</span>' : ''}
                    </span>
                    <input type="text" class="tab-title-input" value="${tab.title}" placeholder="탭 제목을 입력하세요 (예: 1단원 지오지브라 탐구)" style="flex: 1; min-width: 220px; padding: 0.55rem 0.9rem; font-size: 0.95rem; font-weight: 600; border-radius: 8px; border: 1.5px solid var(--border-color); background: rgba(255, 255, 255, 0.08); color: var(--text-primary); outline: none; transition: border-color 0.2s;">
                </div>

                <div style="display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap;">
                    <!-- Per-tab layout selector -->
                    <div style="display: flex; align-items: center; gap: 0.45rem; background: rgba(255, 255, 255, 0.05); padding: 0.35rem 0.65rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); white-space: nowrap;">내부 배치:</span>
                        <select class="tab-layout-select" style="padding: 0.4rem 0.75rem; font-size: 0.85rem; font-weight: 600; border-radius: 6px; border: 1px solid var(--border-color); background: #ffffff; color: #1e293b; cursor: pointer; outline: none;">
                            <option value="split" ${tab.layout === 'split' ? 'selected' : ''}>🪟 다단 분할 뷰</option>
                            <option value="scroll" ${tab.layout === 'scroll' ? 'selected' : ''}>📜 상하 스크롤 뷰</option>
                        </select>
                    </div>

                    <!-- Reorder and delete tab -->
                    <div style="display: flex; gap: 0.35rem;">
                        <button type="button" class="btn btn-secondary btn-sm btn-tab-move-up" title="탭 순서 위로" style="padding: 0.45rem 0.7rem; font-size: 0.85rem;" ${tabIdx === 0 ? 'disabled' : ''}>▲</button>
                        <button type="button" class="btn btn-secondary btn-sm btn-tab-move-down" title="탭 순서 아래로" style="padding: 0.45rem 0.7rem; font-size: 0.85rem;" ${tabIdx === tabsList.length - 1 ? 'disabled' : ''}>▼</button>
                        <button type="button" class="btn btn-secondary btn-sm btn-delete-entire-tab" style="padding: 0.45rem 0.8rem; font-size: 0.85rem; color: #f87171; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08); font-weight: 600;" title="탭 삭제">🗑️ 탭 삭제</button>
                    </div>
                </div>
            `;

            // Tab title input listener
            const titleInput = tabHeader.querySelector('.tab-title-input');
            titleInput.addEventListener('focus', () => {
                if (selectedTabId !== tab.id) {
                    selectedTabId = tab.id;
                    renderTabsStructure();
                }
            });
            titleInput.addEventListener('input', (e) => {
                tab.title = e.target.value.trim() || `탐구 활동 ${tabIdx + 1}`;
            });

            // Layout select listener
            const layoutSelect = tabHeader.querySelector('.tab-layout-select');
            layoutSelect.addEventListener('change', (e) => {
                tab.layout = e.target.value;
            });

            // Tab move up
            tabHeader.querySelector('.btn-tab-move-up').addEventListener('click', () => {
                if (tabIdx > 0) {
                    const temp = tabsList[tabIdx];
                    tabsList[tabIdx] = tabsList[tabIdx - 1];
                    tabsList[tabIdx - 1] = temp;
                    renderTabsStructure();
                }
            });

            // Tab move down
            tabHeader.querySelector('.btn-tab-move-down').addEventListener('click', () => {
                if (tabIdx < tabsList.length - 1) {
                    const temp = tabsList[tabIdx];
                    tabsList[tabIdx] = tabsList[tabIdx + 1];
                    tabsList[tabIdx + 1] = temp;
                    renderTabsStructure();
                }
            });

            // Tab delete
            tabHeader.querySelector('.btn-delete-entire-tab').addEventListener('click', () => {
                if (tabsList.length === 1) {
                    alert("수업에는 최소 1개의 탭이 존재해야 합니다.");
                    return;
                }
                if (confirm(`'${tab.title}' 탭과 탭 내부의 모든 자료를 삭제하시겠습니까?`)) {
                    tabsList.splice(tabIdx, 1);
                    if (selectedTabId === tab.id) {
                        selectedTabId = tabsList[0].id;
                    }
                    renderTabsStructure();
                }
            });

            tabCard.appendChild(tabHeader);

            // Nested Items Area
            const itemsArea = document.createElement('div');
            itemsArea.style.cssText = 'display: flex; flex-direction: column; gap: 0.6rem;';

            // Items List Box
            const itemsListBox = document.createElement('div');
            itemsListBox.style.cssText = 'display: flex; flex-direction: column; gap: 0.5rem;';

            if (tab.items.length === 0) {
                itemsListBox.innerHTML = `
                    <div style="text-align: center; padding: 1rem; border: 1px dashed rgba(255,255,255,0.1); border-radius: 8px; color: var(--text-secondary); font-size: 0.85rem;">
                        이 탭에 담긴 자료가 없습니다. 아래 버튼으로 웹 링크, 파일, 화이트보드를 추가하거나, 탭을 선택하고 <strong>Ctrl+V</strong>로 캡처 이미지를 바로 붙여넣으세요!
                    </div>
                `;
            } else {
                tab.items.forEach((item, itemIdx) => {
                    const itemRow = document.createElement('div');
                    itemRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; background: rgba(15,23,42,0.4); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.5rem 0.8rem; flex-wrap: wrap;';

                    let icon = '📄';
                    let desc = item.name || '';
                    if (item.type === 'url') {
                        icon = '🌐';
                        desc = item.url;
                    } else if (item.type === 'blank') {
                        icon = '📄';
                        desc = '자유 화이트보드';
                    } else if (item.type === 'coordinate') {
                        icon = '📐';
                        desc = '수학 좌표평면';
                    } else if (item.type === 'pdf' || (item.name && item.name.endsWith('.pdf'))) {
                        icon = '📕';
                        desc = item.size ? `${(item.size/1024).toFixed(1)} KB` : 'PDF 문서';
                    } else if (item.type === 'html' || (item.name && item.name.endsWith('.html'))) {
                        icon = '💻';
                        desc = item.size ? `${(item.size/1024).toFixed(1)} KB` : 'HTML 시뮬레이션';
                    } else {
                        icon = '🖼️';
                        desc = item.size ? `${(item.size/1024).toFixed(1)} KB` : '이미지';
                    }

                    itemRow.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 0.6rem; flex: 1; min-width: 240px; overflow: hidden;">
                            <span style="font-size: 1.2rem;">${icon}</span>
                            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                                <input type="text" class="item-name-input" value="${item.name}" placeholder="자료 이름" style="width: 100%; max-width: 320px; padding: 0.4rem 0.65rem; font-size: 0.9rem; font-weight: 500; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.08); color: var(--text-primary); outline: none;">
                                <span style="font-size: 0.75rem; color: var(--text-secondary); display: block; overflow: hidden; text-overflow: ellipsis; margin-top: 3px;">${desc}</span>
                            </div>
                        </div>

                        <div style="display: flex; align-items: center; gap: 0.3rem;">
                            <button type="button" class="btn btn-secondary btn-sm btn-item-up" title="자료 순서 위로" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;" ${itemIdx === 0 ? 'disabled' : ''}>▲</button>
                            <button type="button" class="btn btn-secondary btn-sm btn-item-down" title="자료 순서 아래로" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;" ${itemIdx === tab.items.length - 1 ? 'disabled' : ''}>▼</button>
                            <button type="button" class="btn btn-secondary btn-sm btn-delete-item" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: #f87171; border-color: rgba(239,68,68,0.2); background: rgba(239,68,68,0.05);">🗑️</button>
                        </div>
                    `;

                    // Item name change
                    const nameInput = itemRow.querySelector('.item-name-input');
                    nameInput.addEventListener('focus', () => {
                        if (selectedTabId !== tab.id) {
                            selectedTabId = tab.id;
                            renderTabsStructure();
                        }
                    });
                    nameInput.addEventListener('input', (e) => {
                        item.name = e.target.value.trim() || '자료';
                    });

                    // Item up
                    itemRow.querySelector('.btn-item-up').addEventListener('click', () => {
                        if (itemIdx > 0) {
                            const temp = tab.items[itemIdx];
                            tab.items[itemIdx] = tab.items[itemIdx - 1];
                            tab.items[itemIdx - 1] = temp;
                            renderTabsStructure();
                        }
                    });

                    // Item down
                    itemRow.querySelector('.btn-item-down').addEventListener('click', () => {
                        if (itemIdx < tab.items.length - 1) {
                            const temp = tab.items[itemIdx];
                            tab.items[itemIdx] = tab.items[itemIdx + 1];
                            tab.items[itemIdx + 1] = temp;
                            renderTabsStructure();
                        }
                    });

                    // Item delete
                    itemRow.querySelector('.btn-delete-item').addEventListener('click', async () => {
                        if (confirm(`'${item.name}' 자료를 이 탭에서 삭제하시겠습니까?`)) {
                            if (item.storagePath && isFirebaseInitialized && storage) {
                                try {
                                    const fileRef = ref(storage, item.storagePath);
                                    await deleteObject(fileRef);
                                } catch (e) {
                                    console.warn("Storage delete error:", e);
                                }
                            }
                            tab.items.splice(itemIdx, 1);
                            renderTabsStructure();
                        }
                    });

                    itemsListBox.appendChild(itemRow);
                });
            }

            itemsArea.appendChild(itemsListBox);

            // Item Quick Add Toolbar for this tab
            const addToolbar = document.createElement('div');
            addToolbar.style.cssText = 'display: flex; gap: 0.4rem; flex-wrap: wrap; background: rgba(255,255,255,0.015); border: 1px dashed var(--border-color); border-radius: 8px; padding: 0.6rem; align-items: center;';

            addToolbar.innerHTML = `
                <button type="button" class="btn btn-secondary btn-sm btn-tab-upload-file" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; background: rgba(99, 102, 241, 0.08); border-color: rgba(99, 102, 241, 0.2); color: #818cf8;">
                    📁 + 파일 올리기 (.html, .pdf, 이미지)
                </button>
                <button type="button" class="btn btn-secondary btn-sm btn-tab-add-url" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; background: rgba(224, 122, 95, 0.08); border-color: rgba(224, 122, 95, 0.2); color: var(--primary);">
                    🌐 + 웹 링크 추가
                </button>
                <button type="button" class="btn btn-secondary btn-sm btn-tab-add-blank" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;">
                    📄 + 화이트보드
                </button>
                <button type="button" class="btn btn-secondary btn-sm btn-tab-add-coord" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; background: rgba(129, 178, 154, 0.08); border-color: rgba(129, 178, 154, 0.2); color: var(--accent);">
                    📐 + 좌표평면
                </button>
                <button type="button" class="btn btn-secondary btn-sm btn-tab-paste-hint" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; background: rgba(244, 162, 97, 0.1); border-color: rgba(244, 162, 97, 0.3); color: #f97316; margin-left: auto;">
                    📋 Ctrl+V 붙여넣기 지원
                </button>
            `;

            // Hidden file input for this tab
            const tabFileInput = document.createElement('input');
            tabFileInput.type = 'file';
            tabFileInput.multiple = true;
            tabFileInput.accept = '.html,.pdf,.png,.jpg,.jpeg,.webp';
            tabFileInput.style.display = 'none';

            tabFileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    processTabFiles(tab, e.target.files);
                }
            });

            addToolbar.querySelector('.btn-tab-upload-file').addEventListener('click', () => {
                selectedTabId = tab.id;
                tabFileInput.click();
            });

            // Add URL
            addToolbar.querySelector('.btn-tab-add-url').addEventListener('click', () => {
                selectedTabId = tab.id;
                const url = prompt("추가할 외부 웹사이트/시뮬레이션 URL을 입력하세요 (https://...):");
                if (url && url.trim()) {
                    let label = '웹 링크';
                    try {
                        const parsed = new URL(url.trim());
                        label = parsed.hostname.replace('www.', '');
                    } catch (e) {
                        label = '웹 링크';
                    }
                    tab.items.push({
                        id: 'item_' + Math.random().toString(36).substr(2, 9),
                        name: label,
                        type: 'url',
                        url: url.trim(),
                        fileObject: null,
                        storagePath: ''
                    });
                    renderTabsStructure();
                }
            });

            // Add Blank
            addToolbar.querySelector('.btn-tab-add-blank').addEventListener('click', () => {
                selectedTabId = tab.id;
                const blankNum = tab.items.filter(i => i.type === 'blank').length + 1;
                tab.items.push({
                    id: 'item_' + Math.random().toString(36).substr(2, 9),
                    name: `화이트보드 ${blankNum}`,
                    type: 'blank',
                    url: '',
                    fileObject: null,
                    storagePath: ''
                });
                renderTabsStructure();
            });

            // Add Coordinate
            addToolbar.querySelector('.btn-tab-add-coord').addEventListener('click', () => {
                selectedTabId = tab.id;
                const coordNum = tab.items.filter(i => i.type === 'coordinate').length + 1;
                tab.items.push({
                    id: 'item_' + Math.random().toString(36).substr(2, 9),
                    name: `좌표평면 ${coordNum}`,
                    type: 'coordinate',
                    url: '',
                    fileObject: null,
                    storagePath: ''
                });
                renderTabsStructure();
            });

            // Paste hint button click -> activate tab
            addToolbar.querySelector('.btn-tab-paste-hint').addEventListener('click', () => {
                selectedTabId = tab.id;
                renderTabsStructure();
                alert(`'${tab.title}' 탭이 선택되었습니다!\n이제 Ctrl+V를 누르면 캡처한 이미지가 이 탭에 바로 추가됩니다.`);
            });

            // Drag over / drop into individual tab card
            tabCard.addEventListener('dragover', (e) => {
                e.preventDefault();
                tabCard.style.borderColor = 'var(--primary)';
            });
            tabCard.addEventListener('dragleave', (e) => {
                e.preventDefault();
                if (selectedTabId !== tab.id) tabCard.style.borderColor = 'var(--border-color)';
            });
            tabCard.addEventListener('drop', (e) => {
                e.preventDefault();
                selectedTabId = tab.id;
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    processTabFiles(tab, e.dataTransfer.files);
                }
            });

            itemsArea.appendChild(addToolbar);
            tabCard.appendChild(itemsArea);
            tabsStructureContainer.appendChild(tabCard);
        });
    }

    function processTabFiles(targetTab, fileList) {
        if (!fileList || fileList.length === 0) return;
        const allowedExtensions = ['.html', '.pdf', '.png', '.jpg', '.jpeg', '.webp'];

        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

            if (!allowedExtensions.includes(ext)) {
                alert(`지원하지 않는 파일 형식입니다: ${file.name}`);
                continue;
            }
            if (ext === '.pdf' && file.size > 10 * 1024 * 1024) {
                alert(`PDF 파일의 최대 허용 크기는 10MB입니다: ${file.name}`);
                continue;
            } else if (ext !== '.pdf' && file.size > 5 * 1024 * 1024) {
                alert(`HTML/이미지 파일의 최대 허용 크기는 5MB입니다: ${file.name}`);
                continue;
            }

            const itemType = ext === '.pdf' ? 'pdf' : (ext === '.html' ? 'html' : 'image');
            const defaultName = file.name.substring(0, file.name.lastIndexOf('.'));

            targetTab.items.push({
                id: 'item_' + Math.random().toString(36).substr(2, 9),
                name: defaultName,
                size: file.size,
                type: itemType,
                fileObject: file,
                url: '',
                storagePath: ''
            });
        }
        renderTabsStructure();
    }

    function getActiveTargetTab() {
        if (tabsList.length === 0) {
            const newTab = {
                id: 'tab_' + Math.random().toString(36).substr(2, 9),
                title: '탐구 활동 1',
                layout: 'split',
                items: []
            };
            tabsList.push(newTab);
            selectedTabId = newTab.id;
            return newTab;
        }
        let target = tabsList.find(t => t.id === selectedTabId);
        if (!target) {
            target = tabsList[0];
            selectedTabId = target.id;
        }
        return target;
    }

    // Helper for hero dropzone
    function processSelectedFiles(fileList) {
        const targetTab = getActiveTargetTab();
        processTabFiles(targetTab, fileList);
    }

    // Bind Clipboard Paste (Ctrl+V) for Screenshots to Active/Selected Tab
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
                
                const targetTab = getActiveTargetTab();
                processTabFiles(targetTab, [screenshotFile]);
                console.log(`Clipboard screenshot added to active tab: ${targetTab.title}`);
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
                
                // 1. Populate tabsList (supporting both new tabs structure and legacy flat files)
                if (roomData.tabs && Array.isArray(roomData.tabs) && roomData.tabs.length > 0) {
                    tabsList = roomData.tabs.map(t => ({
                        id: t.id || ('tab_' + Math.random().toString(36).substr(2, 9)),
                        title: t.title || t.name || '탐구 활동',
                        layout: t.layout || 'split',
                        items: (t.items || []).map(item => ({
                            id: item.id || ('item_' + Math.random().toString(36).substr(2, 9)),
                            name: item.name || '자료',
                            size: item.size || 0,
                            type: item.type || (item.name && item.name.endsWith('.pdf') ? 'pdf' : (item.name && item.name.endsWith('.html') ? 'html' : 'image')),
                            url: item.url || '',
                            storagePath: item.storagePath || '',
                            fileObject: null
                        }))
                    }));
                } else if (roomData.files && Array.isArray(roomData.files)) {
                    // Normalize flat files into 2-tier tabs
                    tabsList = roomData.files.map(f => ({
                        id: f.id,
                        title: f.label || f.name,
                        layout: f.layout || 'split',
                        items: [{
                            id: 'item_' + f.id,
                            name: f.name || f.label,
                            size: f.size || 0,
                            type: f.type || 'url',
                            url: f.url || '',
                            storagePath: f.storagePath || '',
                            fileObject: null
                        }]
                    }));
                }

                // 2. Populate questions
                questions = roomData.questions || [];

                // 3. Update UI: Canvas Option Radio
                const canvasIndependent = document.querySelector('input[name="canvas-option"][value="independent"]');
                const canvasGlobal = document.querySelector('input[name="canvas-option"][value="global"]');
                if (roomData.globalCanvas) {
                    if (canvasGlobal) canvasGlobal.checked = true;
                } else {
                    if (canvasIndependent) canvasIndependent.checked = true;
                }

                // 3-2. Update UI: Time Tracking Checkbox
                const checkTimeTracking = document.getElementById('check-time-tracking');
                if (checkTimeTracking) {
                    checkTimeTracking.checked = roomData.enableTimeTracking !== false;
                }

                // 4. Update UI: Room ID input (Disable it)
                const customRoomIdInput = document.getElementById('custom-room-id');
                if (customRoomIdInput) {
                    customRoomIdInput.value = editRoomId;
                    customRoomIdInput.disabled = true;
                }

                // 5. Update UI: Submit Button Text
                const btnCreateRoom = document.getElementById('btn-create-room');
                if (btnCreateRoom) {
                    const btnText = btnCreateRoom.querySelector('.btn-text');
                    if (btnText) btnText.textContent = '🛠️ 수업 밀키트 수정 완료';
                }

                // Render lists
                renderTabsStructure();
                renderQuestionsConfig();

                console.log("Room settings loaded for editing:", editRoomId);
            }
        } catch (err) {
            console.error("수업방 수정 정보 불러오기 실패:", err);
        }
    }

    // Render initial empty or default tab
    renderTabsStructure();

    // Create Room Submit
    createRoomForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Check that there is at least one tab and one item in total
        const totalItemsCount = tabsList.reduce((sum, tab) => sum + tab.items.length, 0);
        if (tabsList.length === 0 || totalItemsCount === 0) {
            alert("최소 1개 이상의 탭과 자료를 등록해 주세요.");
            return;
        }

        if (!isFirebaseInitialized || !db || !storage) {
            console.error("수업방 생성 실패: Firebase가 초기화되지 않았습니다.");
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
            // Upload files for each tab and serialize 2-tier structure
            const finalTabsList = [];
            for (let t = 0; t < tabsList.length; t++) {
                const tab = tabsList[t];
                const finalItems = [];

                for (let i = 0; i < tab.items.length; i++) {
                    const item = tab.items[i];

                    if (item.type === 'url') {
                        finalItems.push({
                            id: item.id,
                            name: item.name,
                            type: 'url',
                            url: item.url,
                            storagePath: ''
                        });
                    } else if (item.type === 'blank' || item.type === 'coordinate') {
                        finalItems.push({
                            id: item.id,
                            name: item.name,
                            type: item.type,
                            url: '',
                            storagePath: ''
                        });
                    } else if (item.url) {
                        // Already uploaded
                        finalItems.push({
                            id: item.id,
                            name: item.name,
                            type: item.type || (item.name.endsWith('.pdf') ? 'pdf' : (item.name.endsWith('.html') ? 'html' : 'image')),
                            url: item.url,
                            storagePath: item.storagePath || ''
                        });
                    } else if (item.fileObject) {
                        const storagePath = `mealkits/${roomId}/${tab.id}_${item.id}_${item.name}`;
                        const fileRef = ref(storage, storagePath);
                        await uploadBytes(fileRef, item.fileObject);
                        const downloadUrl = await getDownloadURL(fileRef);

                        item.url = downloadUrl;
                        item.storagePath = storagePath;

                        finalItems.push({
                            id: item.id,
                            name: item.name,
                            type: item.type || (item.name.endsWith('.pdf') ? 'pdf' : (item.name.endsWith('.html') ? 'html' : 'image')),
                            url: downloadUrl,
                            storagePath: storagePath
                        });
                    }
                }

                finalTabsList.push({
                    id: tab.id,
                    title: tab.title,
                    layout: tab.layout || 'split',
                    items: finalItems
                });
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

            // Construct roomData with tabs hierarchy as primary
            const roomData = {
                tabs: finalTabsList,
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
            const totalItemsCount = tabsList.reduce((sum, tab) => sum + tab.items.length, 0);
            if (tabsList.length === 0 || totalItemsCount === 0) {
                alert("미리보기를 하기 전에 최소 1개 이상의 탭과 자료를 등록해 주세요.");
                return;
            }
            for (let i = 0; i < questions.length; i++) {
                if (!questions[i].question.trim()) {
                    alert(`질문 #${i + 1}의 질문 타이틀을 입력하세요.`);
                    return;
                }
            }

            // Convert local files to data urls for client preview
            const tempTabsList = [];
            for (let t = 0; t < tabsList.length; t++) {
                const tab = tabsList[t];
                const tempItems = [];

                for (let i = 0; i < tab.items.length; i++) {
                    const item = tab.items[i];
                    let fileDataUrl = '';

                    if (item.type === 'url') {
                        fileDataUrl = item.url;
                    } else if (item.type === 'blank' || item.type === 'coordinate') {
                        fileDataUrl = '';
                    } else if (item.url) {
                        fileDataUrl = item.url;
                    } else if (item.fileObject) {
                        fileDataUrl = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.readAsDataURL(item.fileObject);
                        });
                    }

                    tempItems.push({
                        id: item.id,
                        name: item.name,
                        type: item.type,
                        url: fileDataUrl
                    });
                }

                tempTabsList.push({
                    id: tab.id,
                    title: tab.title,
                    layout: tab.layout || 'split',
                    items: tempItems
                });
            }

            const canvasOptionEl = document.querySelector('input[name="canvas-option"]:checked');
            const globalCanvas = canvasOptionEl ? (canvasOptionEl.value === 'global') : false;

            const previewData = {
                tabs: tempTabsList,
                globalCanvas: globalCanvas,
                questions: questions
            };

            const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(previewData))));
            window.open(`student.html?mode=preview&data=${encodeURIComponent(encodedData)}`, '_blank');
        });
    }
});
