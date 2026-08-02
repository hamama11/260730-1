import { db, auth, googleProvider, isFirebaseInitialized } from "./firebaseConfig.js";
import { doc, getDoc, collection, onSnapshot, writeBatch } from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";

document.addEventListener('DOMContentLoaded', async () => {
    const submissionsContainer = document.getElementById('submissions-container');
    if (!submissionsContainer) return;

    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('id');
    const teacherId = urlParams.get('teacherId');
    const secretKey = urlParams.get('key');

    if (!roomId || !secretKey || !teacherId) {
        alert("잘못된 접근입니다. 수업 ID, 교사 식별 정보 및 보안 키가 필요합니다.");
        window.location.href = 'index.html';
        return;
    }

    let currentSubmissions = [];
    let currentRoomData = null;
    let isListenerActive = false;

    // Start Firestore real-time listener on submissions
    function setupSubmissionsListener() {
        if (isListenerActive) return;
        isListenerActive = true;

        const subCollectionRef = collection(db, "users", teacherId, "rooms", roomId, "submissions");

        onSnapshot(subCollectionRef, (snapshot) => {
            const submissions = [];
            snapshot.forEach(doc => {
                submissions.push({ id: doc.id, ...doc.data() });
            });

            currentSubmissions = submissions;

            // Update count badge
            document.getElementById('info-student-count').textContent = `${submissions.length}명`;

            // Clear layout container
            submissionsContainer.innerHTML = '';

            if (submissions.length === 0) {
                submissionsContainer.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">⏳</div>
                        <p>아직 제출한 학생이 없습니다. 학생들이 학생 링크를 통해 답안을 제출하면 실시간으로 반영됩니다.</p>
                    </div>
                `;
                return;
            }

            // Sort submissions by studentId (alphanumeric), then timestamp asc in memory
            submissions.sort((a, b) => {
                const idA = (a.studentId || "").toString().trim();
                const idB = (b.studentId || "").toString().trim();
                if (idA !== idB) {
                    return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
                }
                const timeA = a.timestamp ? a.timestamp.toDate().getTime() : 0;
                const timeB = b.timestamp ? b.timestamp.toDate().getTime() : 0;
                return timeA - timeB;
            });

            // Render submissions
            submissions.forEach(sub => {
                const card = document.createElement('div');
                card.className = 'submission-card';

                const dateStr = sub.timestamp ? sub.timestamp.toDate().toLocaleTimeString('ko-KR') : '-';

                // Helper: escape raw text, then wrap pasted segments in highlight-paste spans
                const highlightPastedText = (rawText, pastedSegments) => {
                    // Escape HTML special chars first to prevent XSS
                    const escaped = rawText
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;');

                    if (!pastedSegments || pastedSegments.length === 0) return escaped;

                    let result = escaped;
                    // Process each pasted segment (escape it the same way before matching)
                    pastedSegments.forEach(seg => {
                        const escapedSeg = seg
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;')
                            .replace(/'/g, '&#039;');
                        if (!escapedSeg.trim()) return;
                        // Escape for use inside regex (no special chars after HTML-escaping)
                        const regexSafe = escapedSeg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        result = result.replace(
                            new RegExp(regexSafe, 'g'),
                            `<span class="highlight-paste" title="붙여넣기된 텍스트">${escapedSeg}</span>`
                        );
                    });
                    return result;
                };

                // Copy/paste badge string
                const hasCopyPaste = (sub.copyCount !== undefined || sub.pasteCount !== undefined);
                const copyPasteBadge = hasCopyPaste
                    ? `<span class="paste-tracker-badge" title="학생 복사/붙여넣기 이력">📋 복사 ${sub.copyCount || 0}회 &nbsp;|&nbsp; 📝 붙여넣기 ${sub.pasteCount || 0}회</span>`
                    : '';

                // Build answers body dynamically
                let answersHtml = '';
                if (Array.isArray(sub.answers)) {
                    sub.answers.forEach((ans, idx) => {
                        let fileHtml = '';
                        if (ans.file) {
                            if (ans.file.type.startsWith('image/')) {
                                fileHtml = `
                                    <div class="submission-attachment-box">
                                        <div class="submission-attachment-info">
                                            <img src="${ans.file.data}" class="submission-attachment-thumb clickable-thumb" alt="${ans.file.name}">
                                            <span style="font-size: 0.75rem; color: var(--text-secondary);">${ans.file.name}</span>
                                        </div>
                                        <button type="button" class="btn btn-secondary btn-sm btn-download-file" data-filename="${ans.file.name}" data-filedata="${ans.file.data}">보기 / 다운로드</button>
                                    </div>
                                `;
                            } else {
                                fileHtml = `
                                    <div class="submission-attachment-box">
                                        <div class="submission-attachment-info">
                                            <span style="font-size: 1.2rem;">📎</span>
                                            <span style="font-size: 0.75rem; color: var(--text-secondary);">${ans.file.name}</span>
                                        </div>
                                        <button type="button" class="btn btn-secondary btn-sm btn-download-file" data-filename="${ans.file.name}" data-filedata="${ans.file.data}">다운로드</button>
                                    </div>
                                `;
                            }
                        }

                        const renderedAnswer = highlightPastedText(ans.answer || '', ans.pastedSegments || []);

                        answersHtml += `
                            <div class="response-block">
                                <strong>질문 ${idx + 1} (${ans.type === 'objective' ? '객관식' : '주관식'}) - ${ans.question}</strong>
                                <p style="line-height: 1.7;">${renderedAnswer}</p>
                                ${fileHtml}
                            </div>
                        `;
                    });
                } else {
                    answersHtml = `
                        <div class="response-block">
                            <strong>질문 A (관찰)</strong>
                            <p>${sub.answerA || ''}</p>
                        </div>
                        <div class="response-block">
                            <strong>질문 B (추론)</strong>
                            <p>${sub.answerB || ''}</p>
                        </div>
                    `;
                }

                let drawingHtml = '';
                if (sub.drawingImg) {
                    drawingHtml = `
                        <div class="response-block" style="border-top: 1px solid var(--border-color); padding-top: 0.8rem; margin-top: 0.8rem;">
                            <strong>🎨 시뮬레이션 필기 / 그리기 캡처</strong>
                            <div style="margin-top: 0.5rem; background: #ffffff; padding: 6px; border-radius: 8px; border: 1px solid var(--border-color); display: inline-block;">
                                <img src="${sub.drawingImg}" class="submission-attachment-thumb clickable-thumb" style="max-width: 100%; height: auto; border: 1px solid var(--border-color); cursor: zoom-in;" alt="Student Drawing">
                            </div>
                        </div>
                    `;
                }

                card.innerHTML = `
                    <div class="card-header" style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                        <span class="student-meta">${sub.studentId || "학번없음"} ${sub.studentName}</span>
                        <span class="time-meta">${dateStr}</span>
                        ${copyPasteBadge}
                    </div>
                    <div class="card-body">
                        ${answersHtml}
                        ${drawingHtml}
                        <div class="response-block feedback-block">
                            <strong>✅ 제출 되었습니다.</strong>
                            <p>${sub.aiHint}</p>
                        </div>
                    </div>
                `;
                submissionsContainer.appendChild(card);
            });
        });
    }

    // Verify room secretKey and initialize dashboard
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
        currentRoomData = roomData;
        if (roomData.secretKey !== secretKey) {
            alert("인증 키가 일치하지 않습니다. 올바른 모니터링 주소인지 확인하세요.");
            window.location.href = 'index.html';
            return;
        }

        // Populate room header info
        document.getElementById('info-room-id').textContent = roomId;
        document.getElementById('info-sim-source').textContent = roomData.simType === 'url' ? '웹 주소 (URL)' : 'HTML 코드';

        // Check authentication and verify room ownership
        if (isFirebaseInitialized && auth) {
            const loginOverlay = document.getElementById('login-overlay');
            const btnOverlayLogin = document.getElementById('btn-overlay-login');
            const btnOverlayBack = document.getElementById('btn-overlay-back');

            if (btnOverlayLogin && btnOverlayBack) {
                btnOverlayLogin.addEventListener('click', async () => {
                    try {
                        await signInWithPopup(auth, googleProvider);
                    } catch (err) {
                        alert("로그인에 실패했습니다: " + err.message);
                    }
                });

                btnOverlayBack.addEventListener('click', () => {
                    window.location.href = 'index.html';
                });
            }

            onAuthStateChanged(auth, async (user) => {
                if (!user) {
                    if (loginOverlay) loginOverlay.classList.remove('hidden');
                } else if (roomData.ownerUid && user.uid !== roomData.ownerUid) {
                    alert("이 수업방에 대한 모니터링 권한이 없습니다. 해당 방을 개설한 교사의 Google 계정으로 로그인해 주세요.");
                    if (loginOverlay) loginOverlay.classList.remove('hidden');
                } else {
                    // Valid Owner, hide login screen and run setup
                    if (loginOverlay) loginOverlay.classList.add('hidden');
                    setupSubmissionsListener();
                }
            });
        } else {
            // Offline/Fallback mode
            setupSubmissionsListener();
        }

    } catch (err) {
        console.error("모니터링 초기화 에러:", err);
        alert("모니터링 대시보드를 로딩하는 도중 오류가 발생했습니다: " + err.message);
        return;
    }

    // Copy Dashboard Link Handler
    document.getElementById('btn-copy-dashboard-link').addEventListener('click', () => {
        const dummy = document.createElement('input');
        document.body.appendChild(dummy);
        dummy.value = window.location.href;
        dummy.select();
        document.execCommand('copy');
        document.body.removeChild(dummy);
        alert('교사용 모니터링 주소가 클립보드에 복사되었습니다. 즐겨찾기에 등록해 보관하세요.');
    });

    // CSV Download handler
    const downloadBtn = document.getElementById('btn-download-csv');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (currentSubmissions.length === 0) {
                alert("제출된 학생 답안이 없어 CSV를 다운로드할 수 없습니다.");
                return;
            }

            if (!confirm("수업을 종료하고 전체 학생 결과 리포트(CSV)를 다운로드하시겠습니까?")) {
                return;
            }

            try {
                // Sort submissions by studentId (alphanumeric), then timestamp asc in memory
                const sortedSubmissions = [...currentSubmissions];
                sortedSubmissions.sort((a, b) => {
                    const idA = (a.studentId || "").toString().trim();
                    const idB = (b.studentId || "").toString().trim();
                    if (idA !== idB) {
                        return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
                    }
                    const timeA = a.timestamp ? a.timestamp.toDate().getTime() : 0;
                    const timeB = b.timestamp ? b.timestamp.toDate().getTime() : 0;
                    return timeA - timeB;
                });

                // Convert to CSV string
                const escapeCsv = (val) => {
                    if (val === null || val === undefined) return "";
                    let str = String(val);
                    str = str.replace(/"/g, '""');
                    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
                        return `"${str}"`;
                    }
                    return str;
                };

                const questions = (currentRoomData && currentRoomData.questions) || [
                    { id: 'q_default_a', question: '질문 A. 시뮬레이션에서 관찰한 특징이나 특이점은 무엇인가요?' },
                    { id: 'q_default_b', question: '질문 B. 관찰을 통해 추론할 수 있는 수학/과학적 원리는 무엇인가요?' }
                ];

                const headers = ["학번", "이름"];
                questions.forEach((q, idx) => {
                    headers.push(`질문 ${idx + 1}: ${q.question}`);
                });
                headers.push("AI 피드백 힌트", "제출시간");

                const csvRows = [headers.join(",")];

                sortedSubmissions.forEach(doc => {
                    const timeStr = doc.timestamp ? doc.timestamp.toDate().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "";
                    
                    const row = [doc.studentId || "", doc.studentName || ""];

                    // Push answers matching each question cell
                    questions.forEach(q => {
                        let answerText = "";
                        if (Array.isArray(doc.answers)) {
                            const ansObj = doc.answers.find(a => a.id === q.id);
                            if (ansObj) {
                                answerText = ansObj.answer || "";
                            }
                        } else {
                            if (q.id === 'q_default_a') answerText = doc.answerA || "";
                            else if (q.id === 'q_default_b') answerText = doc.answerB || "";
                        }
                        row.push(answerText);
                    });

                    row.push(doc.aiHint || "", timeStr);
                    csvRows.push(row.map(escapeCsv).join(","));
                });

                // Add UTF-8 BOM (\uFEFF) to prevent Excel Korean character corruption
                const csvContent = "\uFEFF" + csvRows.join("\r\n");

                // Trigger browser file download
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

                alert("CSV 보고서 다운로드가 완료되었습니다!");
            } catch (err) {
                console.error("CSV 다운로드 에러:", err);
                alert("다운로드 중 오류가 발생했습니다: " + err.message);
            }
        });
    }

    // Submission Data Reset Modal handlers
    const btnResetData = document.getElementById('btn-reset-data');
    const resetModal = document.getElementById('reset-modal');
    const resetConfirmText = document.getElementById('reset-confirm-text');
    const btnResetCancel = document.getElementById('btn-reset-cancel');
    const btnResetConfirm = document.getElementById('btn-reset-confirm');

    if (btnResetData && resetModal) {
        btnResetData.addEventListener('click', () => {
            resetConfirmText.value = '';
            btnResetConfirm.disabled = true;
            resetModal.classList.remove('hidden');
        });

        btnResetCancel.addEventListener('click', () => {
            resetModal.classList.add('hidden');
        });

        resetConfirmText.addEventListener('input', (e) => {
            btnResetConfirm.disabled = e.target.value.trim() !== "초기화";
        });

        btnResetConfirm.addEventListener('click', async () => {
            btnResetConfirm.disabled = true;
            btnResetConfirm.textContent = "삭제 중...";
            
            try {
                if (currentSubmissions.length === 0) {
                    alert("초기화할 제출 데이터가 없습니다.");
                    resetModal.classList.add('hidden');
                    return;
                }

                const batch = writeBatch(db);
                currentSubmissions.forEach(sub => {
                    const docRef = doc(db, "users", teacherId, "rooms", roomId, "submissions", sub.id);
                    batch.delete(docRef);
                });

                await batch.commit();
                alert("제출 데이터 초기화가 완료되었습니다.");
                resetModal.classList.add('hidden');
            } catch (err) {
                console.error("데이터 초기화 에러:", err);
                alert("초기화 도중 오류가 발생했습니다: " + err.message);
            } finally {
                btnResetConfirm.disabled = false;
                btnResetConfirm.textContent = "삭제 실행";
            }
        });
    }

    // Image Zoom Modal & Click Delegation for Attachments
    const imagePreviewModal = document.getElementById('image-preview-modal');
    const zoomedImage = document.getElementById('zoomed-image');

    if (imagePreviewModal && zoomedImage) {
        imagePreviewModal.addEventListener('click', () => {
            imagePreviewModal.classList.add('hidden');
        });
    }

    if (submissionsContainer) {
        submissionsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('clickable-thumb')) {
                if (zoomedImage && imagePreviewModal) {
                    zoomedImage.src = e.target.src;
                    imagePreviewModal.classList.remove('hidden');
                }
            }

            if (e.target.classList.contains('btn-download-file')) {
                const fileName = e.target.dataset.filename;
                const fileData = e.target.dataset.filedata;
                if (fileName && fileData) {
                    const link = document.createElement('a');
                    link.href = fileData;
                    link.download = fileName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            }
        });
    }
});
