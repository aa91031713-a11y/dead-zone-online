const socket=io();
let state=null, chat=[];
const $=id=>document.getElementById(id);
function toast(t){$("toast").textContent=t;$("toast").style.display="block";setTimeout(()=>$("toast").style.display="none",2600)}
function call(event,data={}){return new Promise(resolve=>socket.emit(event,data,r=>{if(r?.error)toast(r.error);else if(r?.ok===false)toast("요청을 처리하지 못했습니다.");resolve(r||{});}))}
socket.on("connect",()=>$("connection").textContent="서버 연결됨");
socket.on("disconnect",()=>$("connection").textContent="연결 끊김");
$("create").onclick=async()=>{const r=await call("createRoom",{name:$("name").value});if(r.roomId){$("entry").classList.add("hidden");$("game").classList.remove("hidden");}};
$("join").onclick=async()=>{const r=await call("joinRoom",{roomId:$("roomCode").value,name:$("name").value});if(r.ok){$("entry").classList.add("hidden");$("game").classList.remove("hidden");}};
socket.on("state",s=>{state=s;render()});
socket.on("announcement",m=>{$("announcement").textContent=m});
socket.on("chat",m=>{chat.push(m);renderChat()});
socket.on("gameOver",g=>{toast(`${g.winner} 승리! ${g.reason}`);alert(`${g.winner} 승리!\n${g.reason}\n\n${g.players.map(p=>`${p.name}: ${p.role}`).join("\n")}`)});
function render(){
 if(!state)return;
 $("roomId").textContent=state.id;$("round").textContent=state.round||"-";$("phase").textContent=({lobby:"대기실",activity:"활동",meeting:"긴급 회의",final:"최종 탈출",ended:"종료"})[state.phase]||state.phase;
 $("announcement").textContent=state.announcement||"";
 $("count").textContent=`${state.players.length}명`;
 $("role").textContent=state.me?.role||"게임 시작 대기";
 $("mission").textContent=state.me?.mission?`비밀 미션: ${state.me.mission}`:"";
 $("mates").textContent=state.mafiaMates?.length?`마피아 동료: ${state.mafiaMates.join(", ")}`:"";
 $("privateNotice").textContent=(state.notices||[]).join("\n");
 $("players").innerHTML=state.players.map(p=>`<div class="player ${p.alive?"":"dead"}"><span>${esc(p.name)} ${p.isHost?"👑":""} ${p.isMe?"(나)":""}</span><span>${p.alive?"생존":"탈락"} · ${esc(p.zone)}</span></div>`).join("");
 $("zones").innerHTML=state.zones.map(z=>`<button class="zone ${state.players.find(p=>p.isMe)?.zone===z?"active":""}" data-zone="${esc(z)}">${esc(z)}</button>`).join("");
 document.querySelectorAll("[data-zone]").forEach(b=>b.onclick=()=>call("move",{zone:b.dataset.zone}));
 $("missions").innerHTML=state.missions.map(m=>`<div class="mission"><div><b>${esc(m.title)}</b><p>${esc(m.description)}</p></div><button data-mission="${m.id}">수행</button></div>`).join("");
 document.querySelectorAll("[data-mission]").forEach(b=>b.onclick=()=>{const id=b.dataset.mission;let answer="";if(id==="cipher")answer=prompt("암호 정답을 입력하세요")||"";if(id==="evidence")answer=prompt("사건 기록 정답을 입력하세요")||"";call("mission",{missionId:id,answer})});
 const host=state.hostId===socket.id;
 $("hostControls").classList.toggle("hidden",!host||state.status!=="lobby");
 $("start").onclick=()=>call("startGame");
 $("end").onclick=()=>call("hostEnd");
 $("actions").classList.toggle("hidden",state.status!=="playing");
 $("target").innerHTML=state.players.filter(p=>p.alive&&!p.isMe).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
 $("attack").onclick=()=>call("attack",{targetId:$("target").value});
 $("protect").onclick=()=>call("protect",{targetId:$("target").value});
 $("vote").onclick=()=>call("vote",{targetId:$("target").value});
 $("meeting").onclick=()=>call("meeting");
 $("finalBox").classList.toggle("hidden",state.phase!=="final");
 $("submitFinal").onclick=()=>call("finalCode",{answer:$("finalAnswer").value});
}
function renderChat(){$("messages").innerHTML=chat.slice(-80).map(m=>`<div class="msg ${m.channel}"><b>${esc(m.name)}</b>: ${esc(m.message)}</div>`).join("");$("messages").scrollTop=$("messages").scrollHeight}
$("send").onclick=sendChat;$("chatInput").addEventListener("keydown",e=>{if(e.key==="Enter")sendChat()});
function sendChat(){call("chat",{message:$("chatInput").value,channel:$("channel").value});$("chatInput").value=""}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
