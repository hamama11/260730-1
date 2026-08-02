import { db, auth, googleProvider, isFirebaseInitialized } from "./firebaseConfig.js";
import { collection, doc, setDoc, query, where, onSnapshot, deleteDoc, getDocs } from "firebase/firestore";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
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
            headers.push("AI 피드백 힌트", "제출시간");

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

                row.push(sub.aiHint || "", timeStr);
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

            snapshot.forEach((roomDoc) => {
                const roomData = roomDoc.data();
                const roomId = roomDoc.id;
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
    }

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    let currentTab = 'tab-url';

    // Default questions configuration setup
    let questions = [
        { 
            id: 'q_default_a', 
            type: 'subjective', 
            question: '질문 A. 시뮬레이션에서 관찰한 특징이나 특이점은 무엇인가요?'
        },
        { 
            id: 'q_default_b', 
            type: 'subjective', 
            question: '질문 B. 관찰을 통해 추론할 수 있는 수학/과학적 원리는 무엇인가요?'
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
                <div class="question-item-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
                    <span class="badge ${q.type === 'objective' ? 'badge-accent' : ''}">${q.type === 'objective' ? '객관식' : '주관식'} 질문 #${qIndex + 1}</span>
                    <button type="button" class="btn btn-secondary btn-sm btn-delete-question" data-index="${qIndex}" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border-color: rgba(239, 68, 68, 0.2); padding: 0.35rem 0.7rem; font-size: 0.8rem;">질문 삭제</button>
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
            question: ''
        });
        renderQuestionsConfig();
    });

    btnAddObjective.addEventListener('click', () => {
        questions.push({
            id: generateId(),
            type: 'objective',
            question: '',
            options: ['옵션 1', '옵션 2']
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

    // Tab switcher
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.add('hidden'));

            btn.classList.add('active');
            currentTab = btn.dataset.tab;
            document.getElementById(currentTab).classList.remove('hidden');

            if (currentTab === 'tab-url') {
                document.getElementById('simulation-url').required = true;
                document.getElementById('simulation-html').required = false;
            } else {
                document.getElementById('simulation-url').required = false;
                document.getElementById('simulation-html').required = true;
            }
        });
    });

    // ── Dropzone Drag & Drop Logic ──
    const htmlDropzone = document.getElementById('html-dropzone');
    const htmlFileInput = document.getElementById('html-file-input');
    const dropzoneText = document.getElementById('dropzone-text');
    const uploadedFileInfo = document.getElementById('uploaded-file-info');
    const simulationHtmlTextarea = document.getElementById('simulation-html');

    if (htmlDropzone && htmlFileInput) {
        // Drag events
        htmlDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            htmlDropzone.style.backgroundColor = 'rgba(224, 122, 95, 0.08)';
            htmlDropzone.style.borderColor = 'var(--primary)';
        });

        htmlDropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            htmlDropzone.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
            htmlDropzone.style.borderColor = 'var(--border-color)';
        });

        const handleHtmlFile = (file) => {
            if (!file) return;
            
            // Check extension
            if (!file.name.toLowerCase().endsWith('.html')) {
                alert('HTML 파일만 업로드할 수 있습니다. (.html 확장자를 확인하세요)');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const code = e.target.result;
                if (simulationHtmlTextarea) {
                    simulationHtmlTextarea.value = code;
                }
                
                // Show file info
                if (uploadedFileInfo) {
                    const sizeKb = (file.size / 1024).toFixed(1);
                    uploadedFileInfo.textContent = `📄 ${file.name} (${sizeKb} KB) - 업로드 완료`;
                    uploadedFileInfo.classList.remove('hidden');
                }
                if (dropzoneText) {
                    dropzoneText.textContent = '파일 선택 완료! 아래 소스코드가 자동 갱신되었습니다.';
                }
                
                // Success log for storage handler link
                console.log("HTML file loaded successfully locally:", file.name);
            };
            reader.readAsText(file);
        };

        htmlDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            htmlDropzone.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
            htmlDropzone.style.borderColor = 'var(--border-color)';
            
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleHtmlFile(e.dataTransfer.files[0]);
            }
        });

        htmlDropzone.addEventListener('click', () => {
            htmlFileInput.click();
        });

        htmlFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleHtmlFile(e.target.files[0]);
            }
        });
    }

    // Create Room Submit
    createRoomForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!isFirebaseInitialized || !db) {
            console.error("수업방 생성 실패: Firebase가 초기화되지 않았거나 db 인스턴스가 존재하지 않습니다.", {
                isFirebaseInitialized,
                db
            });
            alert("Firebase 연동에 실패하여 수업방을 만들 수 없습니다. 에뮬레이터 또는 호스팅 서버에서 실행해 주세요. 대신 '학생 화면 미리보기'는 이용하실 수 있습니다.");
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
            alert("수업방 고유 ID는 영문, 숫자, 하이픈(-)만 사용할 수 있으며 공백을 포함할 수 없습니다.");
            return;
        }

        const teacherUid = auth.currentUser ? auth.currentUser.uid : "offline";
        const newRoomRef = doc(db, "users", teacherUid, "rooms", roomId);

        // Check if roomId is already taken by this teacher
        try {
            const checkDoc = await getDoc(newRoomRef);
            if (checkDoc.exists()) {
                const overwrite = confirm("이미 본인 계정에 생성된 동일한 수업방 ID가 존재합니다. 설정을 덮어쓰시겠습니까?");
                if (!overwrite) return;
            }
        } catch (err) {
            console.warn("중복 방 ID 조회 실패:", err);
        }

        // Validate questions titles
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

        const simUrl = document.getElementById('simulation-url').value;
        const simHtml = document.getElementById('simulation-html').value;

        const btnCreateRoom = document.getElementById('btn-create-room');
        const btnText = btnCreateRoom.querySelector('.btn-text');
        const spinner = btnCreateRoom.querySelector('.spinner');

        // Show cute loader modal and animate progress bar
        const cuteLoader = document.getElementById('cute-loader-modal');
        const progressFill = cuteLoader ? cuteLoader.querySelector('.cute-progress-fill') : null;
        if (cuteLoader) {
            cuteLoader.classList.remove('hidden');
            if (progressFill) {
                progressFill.style.animation = 'none';
                progressFill.offsetHeight; // trigger reflow
                progressFill.style.animation = 'fillCuteProgress 1.5s forwards linear';
            }
        }

        try {
            // Wait 1.5 seconds to build anticipation and showcase animation
            await new Promise(resolve => setTimeout(resolve, 1500));

            const secretKey = 'sec_' + generateSecretKey(16);

            const roomData = {
                simType: currentTab === 'tab-url' ? 'url' : 'html',
                simData: currentTab === 'tab-url' ? simUrl : simHtml,
                secretKey: secretKey,
                questions: questions,
                ownerUid: teacherUid,
                createdAt: new Date()
            };

            await setDoc(newRoomRef, roomData);

            const origin = window.location.origin;
            const studentLink = `${origin}/student.html?teacherId=${teacherUid}&id=${roomId}`;
            const dashboardLink = `${origin}/teacherMonitor.html?teacherId=${teacherUid}&id=${roomId}&key=${secretKey}`;

            document.getElementById('student-link-input').value = studentLink;
            document.getElementById('dashboard-link-input').value = dashboardLink;

            // Bind Direct Entrance Buttons
            const btnEnterStudent = document.getElementById('btn-enter-student');
            const btnEnterDashboard = document.getElementById('btn-enter-dashboard');
            if (btnEnterStudent) {
                const newBtn = btnEnterStudent.cloneNode(true);
                btnEnterStudent.parentNode.replaceChild(newBtn, btnEnterStudent);
                newBtn.addEventListener('click', () => {
                    window.open(studentLink, '_blank');
                });
            }
            if (btnEnterDashboard) {
                const newBtn = btnEnterDashboard.cloneNode(true);
                btnEnterDashboard.parentNode.replaceChild(newBtn, btnEnterDashboard);
                newBtn.addEventListener('click', () => {
                    window.open(dashboardLink, '_blank');
                });
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

        } catch (err) {
            console.error("수업방 생성 에러:", err);
            alert("수업방을 생성하는 도중 오류가 발생했습니다: " + err.message);
        } finally {
            // Hide cute loader modal
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
        btnPreview.addEventListener('click', () => {
            for (let i = 0; i < questions.length; i++) {
                if (!questions[i].question.trim()) {
                    alert(`질문 #${i + 1}의 질문 타이틀을 입력하세요.`);
                    return;
                }
            }

            const simUrl = document.getElementById('simulation-url').value;
            const simHtml = document.getElementById('simulation-html').value;

            const previewData = {
                simType: currentTab === 'tab-url' ? 'url' : 'html',
                simData: currentTab === 'tab-url' ? simUrl : simHtml,
                questions: questions
            };

            const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(previewData))));
            window.open(`student.html?mode=preview&data=${encodeURIComponent(encodedData)}`, '_blank');
        });
    }
});
