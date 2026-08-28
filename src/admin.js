import { db, auth, storage, googleProvider, isFirebaseInitialized } from "./firebaseConfig.js";
import { doc, getDoc, collection, onSnapshot, writeBatch, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";
import QRCode from 'qrcode';

document.addEventListener('DOMContentLoaded', async () => {
    const submissionsContainer = document.getElementById('submissions-container');
    if (!submissionsContainer) return;

    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('id');
    const teacherId = urlParams.get('teacherId');
    const secretKey = urlParams.get('key');

    // Highlight pasted text inside student answers in red
    function highlightPastedText(text, pastedSegments) {
        if (!pastedSegments || pastedSegments.length === 0 || !text) {
            return text;
        }
        let escapedText = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        pastedSegments.forEach(segment => {
            if (!segment.trim()) return;
            const escapedSegment = segment
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
            
            const regex = new RegExp(escapedSegment.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
            escapedText = escapedText.replace(regex, `<span style="color: #ef4444; font-weight: 600; text-decoration: underline;">${escapedSegment}</span>`);
        });
        return escapedText;
    }

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

    const studentQrModal = document.getElementById('student-qr-modal');
    if (studentQrModal) {
        const card = studentQrModal.querySelector('.draggable-card');
        const handle = studentQrModal.querySelector('.drag-handle');
        if (card && handle) {
            makeDraggable(card, handle);
        }
    }

    const tabsManagerModal = document.getElementById('tabs-manager-modal');
    if (tabsManagerModal) {
        const card = tabsManagerModal.querySelector('.draggable-card');
        const handle = tabsManagerModal.querySelector('.drag-handle');
        if (card && handle) {
            makeDraggable(card, handle);
        }
    }

    if (!roomId || !secretKey || !teacherId) {
        alert("잘못된 접근입니다. 수업 ID, 교사 식별 정보 및 보안 키가 필요합니다.");
        window.location.href = 'index.html';
        return;
    }

    let currentSubmissions = [];
    let currentRoomData = null;
    let isListenerActive = false;

    // Render current tabs list inside Modal (2-tier tabs hierarchy support)
    function renderMonitorTabsList() {
        const listEl = document.getElementById('monitor-tabs-list');
        const countEl = document.getElementById('monitor-tabs-count');
        if (!listEl) return;

        let tabs = [];
        if (currentRoomData && currentRoomData.tabs && Array.isArray(currentRoomData.tabs)) {
            tabs = currentRoomData.tabs;
        } else if (currentRoomData && currentRoomData.files && Array.isArray(currentRoomData.files)) {
            tabs = currentRoomData.files.map(f => ({
                id: f.id,
                title: f.label || f.name,
                layout: f.layout || 'split',
                items: [{ id: 'item_' + f.id, name: f.name || f.label, type: f.type, url: f.url }]
            }));
        }

        if (countEl) countEl.textContent = `${tabs.length}`;
        listEl.innerHTML = '';

        if (tabs.length === 0) {
            listEl.innerHTML = '<p style="text-align: center; color: var(--text-secondary); font-size: 0.85rem; padding: 1rem;">등록된 탭이 없습니다.</p>';
            return;
        }

        tabs.forEach((tab, idx) => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.8rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 8px; gap: 0.6rem;';

            const isScroll = tab.layout === 'scroll';
            const isPublished = tab.published !== false;
            const itemsCount = (tab.items || []).length;
            const itemsSummary = (tab.items || []).map(i => i.name).slice(0, 2).join(', ');

            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.6rem; overflow: hidden; flex: 1;">
                    <span style="font-size: 1.2rem;">${isPublished ? '🔓' : '🔒'}</span>
                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                        <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary); display: block;">${tab.title} (${itemsCount}개 자료)</span>
                        <span style="font-size: 0.7rem; color: var(--text-secondary); display: block; overflow: hidden; text-overflow: ellipsis;">${itemsSummary || '자료 없음'}</span>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0;">
                    <label class="switch-toggle" title="클릭하여 학생 공개 ON/OFF 전환">
                        <input type="checkbox" class="tab-monitor-publish-toggle" data-tabidx="${idx}" ${isPublished ? 'checked' : ''}>
                        <span class="switch-slider"></span>
                        <span class="switch-label-text" style="color: ${isPublished ? '#22c55e' : '#94a3b8'}; font-size: 0.75rem;">${isPublished ? 'ON (공개)' : 'OFF (개봉예정)'}</span>
                    </label>
                    <select class="tab-monitor-layout" data-tabidx="${idx}" style="padding: 0.25rem 0.4rem; font-size: 0.75rem; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(15,23,42,0.4); color: var(--text-primary); cursor: pointer;">
                        <option value="scroll" ${isScroll ? 'selected' : ''}>📜 스크롤</option>
                        <option value="split" ${!isScroll ? 'selected' : ''}>🪟 분할</option>
                    </select>
                    <button type="button" class="btn btn-secondary btn-sm btn-tab-up" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;" title="순서 위로" ${idx === 0 ? 'disabled' : ''}>▲</button>
                    <button type="button" class="btn btn-secondary btn-sm btn-tab-down" style="padding: 0.25rem 0.45rem; font-size: 0.75rem;" title="순서 아래로" ${idx === tabs.length - 1 ? 'disabled' : ''}>▼</button>
                    <button type="button" class="btn btn-secondary btn-sm btn-delete-tab" data-tabidx="${idx}" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; color: #f87171; border-color: rgba(239,68,68,0.2); background: rgba(239,68,68,0.05);">🗑️ 삭제</button>
                </div>
            `;

            // Toggle publish switch handler
            const publishToggle = item.querySelector('.tab-monitor-publish-toggle');
            if (publishToggle) {
                publishToggle.addEventListener('change', async (e) => {
                    const newTabs = [...tabs];
                    newTabs[idx] = { ...newTabs[idx], published: e.target.checked };
                    try {
                        const roomRef = doc(db, "users", teacherId, "rooms", roomId);
                        await updateDoc(roomRef, { tabs: newTabs });
                        currentRoomData.tabs = newTabs;
                        renderMonitorTabsList();
                    } catch (err) {
                        console.error("공개 상태 변경 실패:", err);
                        alert("공개 상태 변경에 실패했습니다: " + err.message);
                    }
                });
            }

            // Layout change handler
            const layoutSelect = item.querySelector('.tab-monitor-layout');
            if (layoutSelect) {
                layoutSelect.addEventListener('change', async (e) => {
                    const newLayout = e.target.value;
                    const newTabs = [...tabs];
                    newTabs[idx] = { ...newTabs[idx], layout: newLayout };
                    try {
                        const roomRef = doc(db, "users", teacherId, "rooms", roomId);
                        await updateDoc(roomRef, { tabs: newTabs });
                        currentRoomData.tabs = newTabs;
                    } catch (err) {
                        console.error("탭 레이아웃 업데이트 실패:", err);
                        alert("탭 레이아웃 변경에 실패했습니다: " + err.message);
                    }
                });
            }

            // Up/Down Reorder handlers
            const upBtn = item.querySelector('.btn-tab-up');
            const downBtn = item.querySelector('.btn-tab-down');

            if (upBtn) {
                upBtn.addEventListener('click', async () => {
                    if (idx > 0) {
                        const newTabs = [...tabs];
                        const temp = newTabs[idx];
                        newTabs[idx] = newTabs[idx - 1];
                        newTabs[idx - 1] = temp;
                        try {
                            const roomRef = doc(db, "users", teacherId, "rooms", roomId);
                            await updateDoc(roomRef, { tabs: newTabs });
                            currentRoomData.tabs = newTabs;
                            renderMonitorTabsList();
                        } catch (e) {
                            console.error("순서 변경 실패:", e);
                        }
                    }
                });
            }

            if (downBtn) {
                downBtn.addEventListener('click', async () => {
                    if (idx < tabs.length - 1) {
                        const newTabs = [...tabs];
                        const temp = newTabs[idx];
                        newTabs[idx] = newTabs[idx + 1];
                        newTabs[idx + 1] = temp;
                        try {
                            const roomRef = doc(db, "users", teacherId, "rooms", roomId);
                            await updateDoc(roomRef, { tabs: newTabs });
                            currentRoomData.tabs = newTabs;
                            renderMonitorTabsList();
                        } catch (e) {
                            console.error("순서 변경 실패:", e);
                        }
                    }
                });
            }

            const delBtn = item.querySelector('.btn-delete-tab');
            delBtn.addEventListener('click', async () => {
                if (tabs.length <= 1) {
                    if (!confirm("마지막 탭을 삭제하시겠습니까? 학생 화면에 표시할 자료가 없게 됩니다.")) return;
                } else {
                    if (!confirm(`'${tab.title}' 탭을 수업에서 삭제하시겠습니까?\n모든 학생의 화면에서 즉시 제거됩니다.`)) return;
                }

                try {
                    const newTabs = [...tabs];
                    newTabs.splice(idx, 1);
                    const roomRef = doc(db, "users", teacherId, "rooms", roomId);
                    await updateDoc(roomRef, { tabs: newTabs });
                    currentRoomData.tabs = newTabs;
                    renderMonitorTabsList();
                    alert("탭이 삭제되었으며 모든 학생 화면에 실시간 반영되었습니다.");
                } catch (err) {
                    console.error("탭 삭제 에러:", err);
                    alert("탭 삭제에 실패했습니다: " + err.message);
                }
            });

            listEl.appendChild(item);
        });
    }

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

                // Paste tracking badge string (removed copy tracking as requested)
                const hasPaste = (sub.pasteCount !== undefined);
                const copyPasteBadge = hasPaste && sub.pasteCount > 0
                    ? `<span class="paste-tracker-badge" title="학생 붙여넣기 이력">📝 외부 텍스트 붙여넣기: ${sub.pasteCount || 0}회</span>`
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
                if (sub.drawings && Object.keys(sub.drawings).length > 0) {
                    let drawingsTabs = '';
                    let drawingsBodies = '';
                    
                    Object.keys(sub.drawings).forEach((fileId, dIdx) => {
                        const fileObj = (currentRoomData && currentRoomData.files && currentRoomData.files.find(f => f.id === fileId)) || { label: `자료 ${dIdx + 1}` };
                        drawingsTabs += `<button type="button" class="btn btn-secondary btn-sm ${dIdx === 0 ? 'active' : ''}" style="padding:0.3rem 0.6rem; font-size:0.75rem; border-color: rgba(255,255,255,0.1);" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('active')); this.classList.add('active'); const wrapper = this.parentNode.nextElementSibling; wrapper.querySelectorAll('.drawing-tab-body').forEach(b=>b.style.display='none'); wrapper.querySelector('.drawing-body-${fileId}').style.display='block';">${fileObj.label}</button>`;
                        drawingsBodies += `<div class="drawing-tab-body drawing-body-${fileId}" style="display: ${dIdx === 0 ? 'block' : 'none'}; margin-top: 0.5rem; background: #ffffff; padding: 6px; border-radius: 8px; border: 1px solid var(--border-color); display: inline-block;">
                            <img src="${sub.drawings[fileId]}" class="submission-attachment-thumb clickable-thumb" style="max-width: 100%; height: auto; border: 1px solid var(--border-color); cursor: zoom-in;" alt="${fileObj.label} Drawing">
                        </div>`;
                    });

                    drawingHtml = `
                        <div class="response-block" style="border-top: 1px solid var(--border-color); padding-top: 0.8rem; margin-top: 0.8rem;">
                            <strong>🎨 시뮬레이션 필기 / 그리기 캡처</strong>
                            <div style="display: flex; gap: 0.35rem; margin-top: 0.5rem; flex-wrap: wrap;">
                                ${drawingsTabs}
                            </div>
                            <div style="display: block;">
                                ${drawingsBodies}
                            </div>
                        </div>
                    `;
                } else if (sub.drawingImg) {
                    drawingHtml = `
                        <div class="response-block" style="border-top: 1px solid var(--border-color); padding-top: 0.8rem; margin-top: 0.8rem;">
                            <strong>🎨 시뮬레이션 필기 / 그리기 캡처</strong>
                            <div style="margin-top: 0.5rem; background: #ffffff; padding: 6px; border-radius: 8px; border: 1px solid var(--border-color); display: inline-block;">
                                <img src="${sub.drawingImg}" class="submission-attachment-thumb clickable-thumb" style="max-width: 100%; height: auto; border: 1px solid var(--border-color); cursor: zoom-in;" alt="Student Drawing">
                            </div>
                        </div>
                    `;
                }

                const timeBadge = sub.elapsedSeconds !== undefined && sub.elapsedSeconds !== null
                    ? `<span class="paste-tracker-badge" style="background: rgba(99, 102, 241, 0.08); border-color: rgba(99, 102, 241, 0.2); color: var(--primary);" title="풀이 소요 시간">⏱️ 소요시간: ${Math.floor(sub.elapsedSeconds / 60)}분 ${sub.elapsedSeconds % 60}초</span>`
                    : '';

                card.innerHTML = `
                    <div class="card-header" style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                        <span class="student-meta">${sub.studentId || "학번없음"} ${sub.studentName}</span>
                        <span class="time-meta">${dateStr}</span>
                        ${copyPasteBadge}
                        ${timeBadge}
                    </div>
                    <div class="card-body">
                        ${answersHtml}
                        ${drawingHtml}
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
        const displayTitle = roomData.title || roomId;
        const infoTitleEl = document.getElementById('info-room-title');
        if (infoTitleEl) infoTitleEl.textContent = displayTitle;
        document.getElementById('info-room-id').textContent = roomId;
        document.getElementById('info-sim-source').textContent = roomData.simType === 'url' ? '웹 주소 (URL)' : 'HTML 코드 / 탭 밀키트';
        document.title = `${displayTitle} - 실시간 모니터링`;

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

    // Direct entrance to student room
    const btnEnterStudentRoom = document.getElementById('btn-enter-student-room');
    if (btnEnterStudentRoom) {
        btnEnterStudentRoom.addEventListener('click', () => {
            const studentUrl = `${window.location.origin}/student.html?teacherId=${teacherId}&id=${roomId}`;
            window.open(studentUrl, '_blank');
        });
    }

    // ── Tab Management Modal Handler ──
    const btnManageTabs = document.getElementById('btn-manage-tabs');
    const btnCloseTabsManager = document.getElementById('btn-close-tabs-manager');
    const btnCloseTabsManagerFooter = document.getElementById('btn-close-tabs-manager-footer');
    
    // Tab Type Switches
    const btnTabTypeUrl = document.getElementById('btn-tabtype-url');
    const btnTabTypeFile = document.getElementById('btn-tabtype-file');
    const btnTabTypeBlank = document.getElementById('btn-tabtype-blank');
    const btnTabTypeCoord = document.getElementById('btn-tabtype-coord');

    const addTabUrlBox = document.getElementById('add-tab-url-box');
    const addTabFileBox = document.getElementById('add-tab-file-box');
    const addTabBlankBox = document.getElementById('add-tab-blank-box');
    const addTabCoordBox = document.getElementById('add-tab-coord-box');
    const btnSubmitAddTab = document.getElementById('btn-submit-add-tab');

    let currentAddType = 'url'; // 'url' | 'file' | 'blank' | 'coordinate'

    const setAddTabType = (type) => {
        currentAddType = type;
        [btnTabTypeUrl, btnTabTypeFile, btnTabTypeBlank, btnTabTypeCoord].forEach(b => {
            if (b) {
                b.classList.remove('active');
                b.style.background = '';
                b.style.color = '';
            }
        });

        if (addTabUrlBox) addTabUrlBox.classList.add('hidden');
        if (addTabFileBox) addTabFileBox.classList.add('hidden');
        if (addTabBlankBox) addTabBlankBox.classList.add('hidden');
        if (addTabCoordBox) addTabCoordBox.classList.add('hidden');

        if (type === 'url') {
            if (btnTabTypeUrl) {
                btnTabTypeUrl.classList.add('active');
                btnTabTypeUrl.style.background = 'var(--primary)';
                btnTabTypeUrl.style.color = 'white';
            }
            if (addTabUrlBox) addTabUrlBox.classList.remove('hidden');
        } else if (type === 'file') {
            if (btnTabTypeFile) {
                btnTabTypeFile.classList.add('active');
                btnTabTypeFile.style.background = 'var(--primary)';
                btnTabTypeFile.style.color = 'white';
            }
            if (addTabFileBox) addTabFileBox.classList.remove('hidden');
        } else if (type === 'blank') {
            if (btnTabTypeBlank) {
                btnTabTypeBlank.classList.add('active');
                btnTabTypeBlank.style.background = 'var(--primary)';
                btnTabTypeBlank.style.color = 'white';
            }
            if (addTabBlankBox) addTabBlankBox.classList.remove('hidden');
        } else if (type === 'coordinate') {
            if (btnTabTypeCoord) {
                btnTabTypeCoord.classList.add('active');
                btnTabTypeCoord.style.background = 'var(--primary)';
                btnTabTypeCoord.style.color = 'white';
            }
            if (addTabCoordBox) addTabCoordBox.classList.remove('hidden');
        }
    };

    if (btnTabTypeUrl) btnTabTypeUrl.addEventListener('click', () => setAddTabType('url'));
    if (btnTabTypeFile) btnTabTypeFile.addEventListener('click', () => setAddTabType('file'));
    if (btnTabTypeBlank) btnTabTypeBlank.addEventListener('click', () => setAddTabType('blank'));
    if (btnTabTypeCoord) btnTabTypeCoord.addEventListener('click', () => setAddTabType('coordinate'));

    if (btnManageTabs && tabsManagerModal) {
        btnManageTabs.addEventListener('click', () => {
            const draggableCard = tabsManagerModal.querySelector('.draggable-card');
            if (draggableCard) {
                draggableCard.style.top = '';
                draggableCard.style.left = '';
                draggableCard.style.position = '';
                draggableCard.style.margin = '';
            }
            renderMonitorTabsList();
            tabsManagerModal.classList.remove('hidden');
        });
    }

    const hideTabsManager = () => {
        if (tabsManagerModal) tabsManagerModal.classList.add('hidden');
    };

    if (btnCloseTabsManager) btnCloseTabsManager.addEventListener('click', hideTabsManager);
    if (btnCloseTabsManagerFooter) btnCloseTabsManagerFooter.addEventListener('click', hideTabsManager);

    // Submit Add New Tab
    if (btnSubmitAddTab) {
        btnSubmitAddTab.addEventListener('click', async () => {
            const files = (currentRoomData && currentRoomData.files) ? [...currentRoomData.files] : [];
            if (files.length >= 10) {
                alert("탭 자료는 최대 10개까지만 등록할 수 있습니다.");
                return;
            }

            let newTabObj = null;
            const newId = 'tab_' + Math.random().toString(36).substr(2, 9);

            if (currentAddType === 'url') {
                const urlInput = document.getElementById('new-tab-url');
                const labelInput = document.getElementById('new-tab-url-label');
                const urlVal = urlInput ? urlInput.value.trim() : '';
                let labelVal = labelInput ? labelInput.value.trim() : '';

                if (!urlVal) {
                    alert("추가할 웹사이트 / 시뮬레이션 URL을 입력해 주세요.");
                    if (urlInput) urlInput.focus();
                    return;
                }

                if (!urlVal.startsWith('http://') && !urlVal.startsWith('https://')) {
                    alert("URL은 http:// 또는 https:// 로 시작해야 합니다.");
                    if (urlInput) urlInput.focus();
                    return;
                }

                if (!labelVal) {
                    try {
                        const parsed = new URL(urlVal);
                        labelVal = parsed.hostname.replace('www.', '');
                    } catch (e) {
                        labelVal = '웹 링크';
                    }
                }

                newTabObj = {
                    id: newId,
                    type: 'url',
                    url: urlVal,
                    name: labelVal,
                    label: labelVal
                };

                // Clear input
                if (urlInput) urlInput.value = '';
                if (labelInput) labelInput.value = '';

            } else if (currentAddType === 'file') {
                const fileInput = document.getElementById('new-tab-file-input');
                const labelInput = document.getElementById('new-tab-file-label');
                if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
                    alert("업로드할 파일을 선택해 주세요.");
                    return;
                }

                const file = fileInput.files[0];
                const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
                const fileType = ext === '.pdf' ? 'pdf' : (ext === '.html' ? 'html' : 'image');
                const defaultLabel = labelInput && labelInput.value.trim() ? labelInput.value.trim() : file.name.substring(0, file.name.lastIndexOf('.'));

                const btnText = btnSubmitAddTab.querySelector('.btn-text');
                const spinner = btnSubmitAddTab.querySelector('.spinner');
                if (btnText) btnText.classList.add('hidden');
                if (spinner) spinner.classList.remove('hidden');
                btnSubmitAddTab.disabled = true;

                try {
                    const storagePath = `mealkits/${roomId}/${newId}_${file.name}`;
                    const fileRef = ref(storage, storagePath);
                    await uploadBytes(fileRef, file);
                    const downloadUrl = await getDownloadURL(fileRef);

                    newTabObj = {
                        id: newId,
                        type: fileType,
                        url: downloadUrl,
                        name: file.name,
                        label: defaultLabel,
                        storagePath: storagePath
                    };

                    fileInput.value = '';
                    if (labelInput) labelInput.value = '';
                } catch (upErr) {
                    console.error("파일 업로드 실패:", upErr);
                    alert("파일 업로드에 실패했습니다: " + upErr.message);
                    if (btnText) btnText.classList.remove('hidden');
                    if (spinner) spinner.classList.add('hidden');
                    btnSubmitAddTab.disabled = false;
                    return;
                }

            } else if (currentAddType === 'blank') {
                const labelInput = document.getElementById('new-tab-blank-label');
                const labelVal = labelInput ? labelInput.value.trim() || '자유 화이트보드' : '자유 화이트보드';

                newTabObj = {
                    id: newId,
                    type: 'blank',
                    name: labelVal,
                    label: labelVal
                };

            } else if (currentAddType === 'coordinate') {
                const labelInput = document.getElementById('new-tab-coord-label');
                const labelVal = labelInput ? labelInput.value.trim() || '좌표평면' : '좌표평면';

                newTabObj = {
                    id: newId,
                    type: 'coordinate',
                    name: labelVal,
                    label: labelVal
                };
            }

            if (!newTabObj) return;

            const layoutSelect = document.getElementById('new-tab-layout-select');
            const selectedLayout = layoutSelect ? layoutSelect.value : 'split';

            // Construct new tab with nested item
            const newTab = {
                id: 'tab_' + Math.random().toString(36).substr(2, 9),
                title: newTabObj.label || newTabObj.name,
                layout: selectedLayout,
                items: [{
                    id: newTabObj.id,
                    name: newTabObj.label || newTabObj.name,
                    type: newTabObj.type,
                    url: newTabObj.url || '',
                    storagePath: newTabObj.storagePath || ''
                }]
            };

            const btnText = btnSubmitAddTab.querySelector('.btn-text');
            const spinner = btnSubmitAddTab.querySelector('.spinner');
            if (btnText) btnText.classList.add('hidden');
            if (spinner) spinner.classList.remove('hidden');
            btnSubmitAddTab.disabled = true;

            try {
                let tabs = [];
                if (currentRoomData && currentRoomData.tabs && Array.isArray(currentRoomData.tabs)) {
                    tabs = [...currentRoomData.tabs];
                } else if (currentRoomData && currentRoomData.files && Array.isArray(currentRoomData.files)) {
                    tabs = currentRoomData.files.map(f => ({
                        id: f.id,
                        title: f.label || f.name,
                        layout: f.layout || 'split',
                        items: [{ id: 'item_' + f.id, name: f.name || f.label, type: f.type, url: f.url }]
                    }));
                }

                tabs.push(newTab);
                const roomRef = doc(db, "users", teacherId, "rooms", roomId);
                await updateDoc(roomRef, { tabs: tabs });
                currentRoomData.tabs = tabs;
                renderMonitorTabsList();
                alert(`'${newTab.title}' 탭이 추가되었습니다!\n모든 학생의 화면에 실시간으로 생성됩니다.`);
            } catch (err) {
                console.error("탭 추가 실패:", err);
                alert("탭 추가에 실패했습니다: " + err.message);
            } finally {
                if (btnText) btnText.classList.remove('hidden');
                if (spinner) spinner.classList.add('hidden');
                btnSubmitAddTab.disabled = false;
            }
        });
    }

    // Student QR code display handler
    const btnShowStudentQr = document.getElementById('btn-show-student-qr');
    const btnCloseMonitorQr = document.getElementById('btn-close-monitor-qr');
    const btnCloseMonitorQrConfirm = document.getElementById('btn-close-monitor-qr-confirm');
    const monitorQrCanvas = document.getElementById('monitor-qr-canvas');
    const qrMonitorRoomId = document.getElementById('qr-monitor-room-id');

    if (btnShowStudentQr && studentQrModal) {
        btnShowStudentQr.addEventListener('click', () => {
            const studentUrl = `${window.location.origin}/student.html?teacherId=${teacherId}&id=${roomId}`;
            const draggableCard = studentQrModal.querySelector('.draggable-card');
            if (draggableCard) {
                draggableCard.style.top = '';
                draggableCard.style.left = '';
                draggableCard.style.position = '';
                draggableCard.style.margin = '';
            }
            
            if (qrMonitorRoomId) qrMonitorRoomId.textContent = roomId;
            studentQrModal.classList.remove('hidden');
            if (monitorQrCanvas) {
                QRCode.toCanvas(monitorQrCanvas, studentUrl, { width: 280, margin: 1 }, function (error) {
                    if (error) console.error("QR Code generation error:", error);
                });
            }
        });
    }

    const hideMonitorQr = () => {
        if (studentQrModal) studentQrModal.classList.add('hidden');
    };

    if (btnCloseMonitorQr) btnCloseMonitorQr.addEventListener('click', hideMonitorQr);
    if (btnCloseMonitorQrConfirm) btnCloseMonitorQrConfirm.addEventListener('click', hideMonitorQr);

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
                headers.push("소요시간(초)", "제출시간");

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

                    const elapsedSecStr = doc.elapsedSeconds !== undefined && doc.elapsedSeconds !== null ? `${doc.elapsedSeconds}초` : "";
                    row.push(elapsedSecStr, timeStr);
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
