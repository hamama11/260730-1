import{d as L,c as q,l as H,i as U,a as B,b as j,g as M,o as O,w as z,f as F,h as K}from"./firebaseConfig-DIj8sDHY.js";document.addEventListener("DOMContentLoaded",async()=>{const p=document.getElementById("submissions-container");if(!p)return;const $=new URLSearchParams(window.location.search),g=$.get("id"),C=$.get("teacherId"),x=$.get("key");if(!g||!x||!C){alert("잘못된 접근입니다. 수업 ID, 교사 식별 정보 및 보안 키가 필요합니다."),window.location.href="index.html";return}let y=[],I=null,S=!1;function A(){if(S)return;S=!0;const n=F(L,"users",C,"rooms",g,"submissions");K(n,c=>{const i=[];if(c.forEach(e=>{i.push({id:e.id,...e.data()})}),y=i,document.getElementById("info-student-count").textContent=`${i.length}명`,p.innerHTML="",i.length===0){p.innerHTML=`
                    <div class="empty-state">
                        <div class="empty-icon">⏳</div>
                        <p>아직 제출한 학생이 없습니다. 학생들이 학생 링크를 통해 답안을 제출하면 실시간으로 반영됩니다.</p>
                    </div>
                `;return}i.sort((e,a)=>{const u=(e.studentId||"").toString().trim(),l=(a.studentId||"").toString().trim();if(u!==l)return u.localeCompare(l,void 0,{numeric:!0,sensitivity:"base"});const w=e.timestamp?e.timestamp.toDate().getTime():0,m=a.timestamp?a.timestamp.toDate().getTime():0;return w-m}),i.forEach(e=>{const a=document.createElement("div");a.className="submission-card";const u=e.timestamp?e.timestamp.toDate().toLocaleTimeString("ko-KR"):"-",l=(t,r)=>{const o=t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");if(!r||r.length===0)return o;let d=o;return r.forEach(h=>{const E=h.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");if(!E.trim())return;const _=E.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");d=d.replace(new RegExp(_,"g"),`<span class="highlight-paste" title="붙여넣기된 텍스트">${E}</span>`)}),d},m=e.copyCount!==void 0||e.pasteCount!==void 0?`<span class="paste-tracker-badge" title="학생 복사/붙여넣기 이력">📋 복사 ${e.copyCount||0}회 &nbsp;|&nbsp; 📝 붙여넣기 ${e.pasteCount||0}회</span>`:"";let s="";Array.isArray(e.answers)?e.answers.forEach((t,r)=>{let o="";t.file&&(t.file.type.startsWith("image/")?o=`
                                    <div class="submission-attachment-box">
                                        <div class="submission-attachment-info">
                                            <img src="${t.file.data}" class="submission-attachment-thumb clickable-thumb" alt="${t.file.name}">
                                            <span style="font-size: 0.75rem; color: var(--text-secondary);">${t.file.name}</span>
                                        </div>
                                        <button type="button" class="btn btn-secondary btn-sm btn-download-file" data-filename="${t.file.name}" data-filedata="${t.file.data}">보기 / 다운로드</button>
                                    </div>
                                `:o=`
                                    <div class="submission-attachment-box">
                                        <div class="submission-attachment-info">
                                            <span style="font-size: 1.2rem;">📎</span>
                                            <span style="font-size: 0.75rem; color: var(--text-secondary);">${t.file.name}</span>
                                        </div>
                                        <button type="button" class="btn btn-secondary btn-sm btn-download-file" data-filename="${t.file.name}" data-filedata="${t.file.data}">다운로드</button>
                                    </div>
                                `);const d=l(t.answer||"",t.pastedSegments||[]);s+=`
                            <div class="response-block">
                                <strong>질문 ${r+1} (${t.type==="objective"?"객관식":"주관식"}) - ${t.question}</strong>
                                <p style="line-height: 1.7;">${d}</p>
                                ${o}
                            </div>
                        `}):s=`
                        <div class="response-block">
                            <strong>질문 A (관찰)</strong>
                            <p>${e.answerA||""}</p>
                        </div>
                        <div class="response-block">
                            <strong>질문 B (추론)</strong>
                            <p>${e.answerB||""}</p>
                        </div>
                    `,a.innerHTML=`
                    <div class="card-header" style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                        <span class="student-meta">${e.studentId||"학번없음"} ${e.studentName}</span>
                        <span class="time-meta">${u}</span>
                        ${m}
                    </div>
                    <div class="card-body">
                        ${s}
                        <div class="response-block feedback-block">
                            <strong>✅ 제출 되었습니다.</strong>
                            <p>${e.aiHint}</p>
                        </div>
                    </div>
                `,p.appendChild(a)})})}try{if(!L)throw new Error("Firebase가 초기화되지 않았습니다.");const n=q(L,"users",C,"rooms",g),c=await H(n);if(!c.exists()){alert("존재하지 않는 수업방입니다."),window.location.href="index.html";return}const i=c.data();if(I=i,i.secretKey!==x){alert("인증 키가 일치하지 않습니다. 올바른 모니터링 주소인지 확인하세요."),window.location.href="index.html";return}if(document.getElementById("info-room-id").textContent=g,document.getElementById("info-sim-source").textContent=i.simType==="url"?"웹 주소 (URL)":"HTML 코드",U&&B){const e=document.getElementById("login-overlay"),a=document.getElementById("btn-overlay-login"),u=document.getElementById("btn-overlay-back");a&&u&&(a.addEventListener("click",async()=>{try{await j(B,M)}catch(l){alert("로그인에 실패했습니다: "+l.message)}}),u.addEventListener("click",()=>{window.location.href="index.html"})),O(B,async l=>{l?i.ownerUid&&l.uid!==i.ownerUid?(alert("이 수업방에 대한 모니터링 권한이 없습니다. 해당 방을 개설한 교사의 Google 계정으로 로그인해 주세요."),e&&e.classList.remove("hidden")):(e&&e.classList.add("hidden"),A()):e&&e.classList.remove("hidden")})}else A()}catch(n){console.error("모니터링 초기화 에러:",n),alert("모니터링 대시보드를 로딩하는 도중 오류가 발생했습니다: "+n.message);return}document.getElementById("btn-copy-dashboard-link").addEventListener("click",()=>{const n=document.createElement("input");document.body.appendChild(n),n.value=window.location.href,n.select(),document.execCommand("copy"),document.body.removeChild(n),alert("교사용 모니터링 주소가 클립보드에 복사되었습니다. 즐겨찾기에 등록해 보관하세요.")});const R=document.getElementById("btn-download-csv");R&&R.addEventListener("click",()=>{if(y.length===0){alert("제출된 학생 답안이 없어 CSV를 다운로드할 수 없습니다.");return}if(confirm("수업을 종료하고 전체 학생 결과 리포트(CSV)를 다운로드하시겠습니까?"))try{const n=[...y];n.sort((s,t)=>{const r=(s.studentId||"").toString().trim(),o=(t.studentId||"").toString().trim();if(r!==o)return r.localeCompare(o,void 0,{numeric:!0,sensitivity:"base"});const d=s.timestamp?s.timestamp.toDate().getTime():0,h=t.timestamp?t.timestamp.toDate().getTime():0;return d-h});const c=s=>{if(s==null)return"";let t=String(s);return t=t.replace(/"/g,'""'),t.includes(",")||t.includes('"')||t.includes(`
`)||t.includes("\r")?`"${t}"`:t},i=I&&I.questions||[{id:"q_default_a",question:"질문 A. 시뮬레이션에서 관찰한 특징이나 특이점은 무엇인가요?"},{id:"q_default_b",question:"질문 B. 관찰을 통해 추론할 수 있는 수학/과학적 원리는 무엇인가요?"}],e=["학번","이름"];i.forEach((s,t)=>{e.push(`질문 ${t+1}: ${s.question}`)}),e.push("AI 피드백 힌트","제출시간");const a=[e.join(",")];n.forEach(s=>{const t=s.timestamp?s.timestamp.toDate().toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"",r=[s.studentId||"",s.studentName||""];i.forEach(o=>{let d="";if(Array.isArray(s.answers)){const h=s.answers.find(E=>E.id===o.id);h&&(d=h.answer||"")}else o.id==="q_default_a"?d=s.answerA||"":o.id==="q_default_b"&&(d=s.answerB||"");r.push(d)}),r.push(s.aiHint||"",t),a.push(r.map(c).join(","))});const u="\uFEFF"+a.join(`\r
`),l=new Blob([u],{type:"text/csv;charset=utf-8;"}),w=URL.createObjectURL(l),m=document.createElement("a");m.setAttribute("href",w),m.setAttribute("download",`수업결과_${g}.csv`),m.style.visibility="hidden",document.body.appendChild(m),m.click(),document.body.removeChild(m),URL.revokeObjectURL(w),alert("CSV 보고서 다운로드가 완료되었습니다!")}catch(n){console.error("CSV 다운로드 에러:",n),alert("다운로드 중 오류가 발생했습니다: "+n.message)}});const D=document.getElementById("btn-reset-data"),b=document.getElementById("reset-modal"),T=document.getElementById("reset-confirm-text"),P=document.getElementById("btn-reset-cancel"),f=document.getElementById("btn-reset-confirm");D&&b&&(D.addEventListener("click",()=>{T.value="",f.disabled=!0,b.classList.remove("hidden")}),P.addEventListener("click",()=>{b.classList.add("hidden")}),T.addEventListener("input",n=>{f.disabled=n.target.value.trim()!=="초기화"}),f.addEventListener("click",async()=>{f.disabled=!0,f.textContent="삭제 중...";try{if(y.length===0){alert("초기화할 제출 데이터가 없습니다."),b.classList.add("hidden");return}const n=z(L);y.forEach(c=>{const i=q(L,"users",C,"rooms",g,"submissions",c.id);n.delete(i)}),await n.commit(),alert("제출 데이터 초기화가 완료되었습니다."),b.classList.add("hidden")}catch(n){console.error("데이터 초기화 에러:",n),alert("초기화 도중 오류가 발생했습니다: "+n.message)}finally{f.disabled=!1,f.textContent="삭제 실행"}}));const v=document.getElementById("image-preview-modal"),k=document.getElementById("zoomed-image");v&&k&&v.addEventListener("click",()=>{v.classList.add("hidden")}),p&&p.addEventListener("click",n=>{if(n.target.classList.contains("clickable-thumb")&&k&&v&&(k.src=n.target.src,v.classList.remove("hidden")),n.target.classList.contains("btn-download-file")){const c=n.target.dataset.filename,i=n.target.dataset.filedata;if(c&&i){const e=document.createElement("a");e.href=i,e.download=c,document.body.appendChild(e),e.click(),document.body.removeChild(e)}}})});
