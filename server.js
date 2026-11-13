const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const rooms = new Map();
const ZONES = ["중앙 본부", "암호 연구실", "보물 창고", "정보실", "협동 훈련실", "안전구역"];
const MISSIONS = [
  { id: "cipher", title: "암호 해독", description: "암호 4-1-3을 해독해 제출하세요.", answer: "413", points: 1 },
  { id: "treasure", title: "보물 찾기", description: "보물 토큰 3개를 수집하세요.", answer: null, points: 1 },
  { id: "team", title: "협동 작전", description: "협동 훈련실에서 팀원 2명 이상과 함께 미션을 시작하세요.", answer: null, points: 1 },
  { id: "evidence", title: "사건 조사", description: "정보실에서 사건 기록의 정답을 입력하세요. 정답은 BLUE입니다.", answer: "BLUE", points: 1 }
];

const ROLE_SETS = {
  16: [
    ["마피아 두목","마피아","마피아","교란자"],
    ["경찰","의사","기자","군인","탐정","정치인","경호원","심리학자","일반 시민","일반 시민","일반 시민","일반 시민"]
  ]
};

function code(n=5) {
  return crypto.randomBytes(4).toString("hex").slice(0,n).toUpperCase();
}
function cleanName(s) {
  return String(s || "").trim().replace(/[<>]/g, "").slice(0,18);
}
function roomOf(socket) {
  const id = socket.data.roomId;
  return id ? rooms.get(id) : null;
}
function playerOf(room, socket) {
  return room?.players.get(socket.id);
}
function mafiaRole(role) {
  return ["마피아 두목","마피아","교란자","암살자","변장 마피아","협박꾼"].includes(role);
}
function alivePlayers(room) {
  return [...room.players.values()].filter(p => p.alive);
}
function publicState(room) {
  return {
    id: room.id, status: room.status, phase: room.phase, round: room.round,
    hostId: room.hostId, zones: ZONES, missions: MISSIONS.map(({id,title,description,points})=>({id,title,description,points})),
    players: [...room.players.values()].map(p => ({
      id:p.id, name:p.name, alive:p.alive, zone:p.zone,
      isHost:p.id===room.hostId, isMe:false
    })),
    completed: room.completed, timeLeft: room.timeLeft || 0,
    announcement: room.announcement,
    votes: room.votes ? room.votes.size : 0
  };
}
function sendState(room) {
  for (const p of room.players.values()) {
    const state = publicState(room);
    state.players = state.players.map(x => ({...x, isMe:x.id===p.id}));
    const self = room.players.get(p.id);
    io.to(p.id).emit("state", {
      ...state,
      me: self ? { role:self.role, mission:self.secretMission, alive:self.alive, points:self.points, abilityUsed:self.abilityUsed } : null,
      mafiaMates: self && mafiaRole(self.role) ? [...room.players.values()].filter(x=>x.id!==p.id && mafiaRole(x.role)).map(x=>x.name) : [],
      notices: room.privateNotices[p.id] || []
    });
    room.privateNotices[p.id] = [];
  }
}
function notice(room, playerId, message) {
  room.privateNotices[playerId] ||= [];
  room.privateNotices[playerId].push(message);
}
function announce(room, message) {
  room.announcement = message;
  io.to(room.id).emit("announcement", message);
}
function endGame(room, winner, reason) {
  room.status = "ended";
  room.phase = "ended";
  room.winner = winner;
  room.announcement = `${winner} 승리! ${reason}`;
  io.to(room.id).emit("gameOver", {
    winner, reason,
    players:[...room.players.values()].map(p=>({name:p.name,role:p.role,alive:p.alive,points:p.points}))
  });
  sendState(room);
}
function checkWin(room) {
  const alive = alivePlayers(room);
  const mafia = alive.filter(p=>mafiaRole(p.role)).length;
  const citizens = alive.length-mafia;
  if (mafia === 0) return endGame(room,"시민팀","모든 마피아가 탈락했습니다.");
  if (mafia >= citizens) return endGame(room,"마피아팀","마피아 수가 시민 수 이상이 되었습니다.");
}

io.on("connection", socket => {
  socket.on("createRoom", ({name}, cb) => {
    name = cleanName(name);
    if (!name) return cb?.({error:"닉네임을 입력하세요."});
    let id = code(5);
    while (rooms.has(id)) id = code(5);
    const room = {
      id, hostId:socket.id, status:"lobby", phase:"lobby", round:0,
      players:new Map(), completed:[], votes:new Map(), privateNotices:{},
      announcement:"방이 생성되었습니다. 참가자를 기다리세요."
    };
    rooms.set(id, room);
    socket.join(id); socket.data.roomId=id;
    room.players.set(socket.id,{id:socket.id,name,alive:true,zone:"중앙 본부",role:null,points:0,abilityUsed:0,missionDone:[],secretMission:null});
    cb?.({roomId:id});
    sendState(room);
  });

  socket.on("joinRoom", ({roomId,name}, cb) => {
    roomId=String(roomId||"").trim().toUpperCase(); name=cleanName(name);
    const room=rooms.get(roomId);
    if (!room) return cb?.({error:"방을 찾을 수 없습니다."});
    if (room.status!=="lobby") return cb?.({error:"이미 게임이 시작된 방입니다."});
    if (!name) return cb?.({error:"닉네임을 입력하세요."});
    if ([...room.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase())) return cb?.({error:"이미 사용 중인 닉네임입니다."});
    socket.join(roomId); socket.data.roomId=roomId;
    room.players.set(socket.id,{id:socket.id,name,alive:true,zone:"중앙 본부",role:null,points:0,abilityUsed:0,missionDone:[],secretMission:null});
    cb?.({ok:true}); announce(room,`${name}님이 참가했습니다.`); sendState(room);
  });

  socket.on("startGame", (_, cb) => {
    const room=roomOf(socket);
    if (!room || room.hostId!==socket.id) return cb?.({error:"방장만 시작할 수 있습니다."});
    const players=[...room.players.values()];
    if (players.length<8) return cb?.({error:"최소 8명부터 시작할 수 있습니다. 16명 이상을 권장합니다."});
    if (room.status!=="lobby") return cb?.({error:"게임이 이미 시작되었습니다."});
    let mafiaCount = players.length>=28?7:players.length>=24?6:players.length>=20?5:players.length>=16?4:Math.max(2,Math.floor(players.length/4));
    const mafiaRoles = ["마피아 두목","마피아","마피아","교란자","마피아","암살자","변장 마피아"];
    const baseCitizenRoles = ["경찰","의사","기자","군인","탐정","정치인","경호원","심리학자"];
    const extraCitizenRoles = ["예언자","복수자","스파이"];
    const shuffled = [...players].sort(()=>Math.random()-.5);
    const roles = [...mafiaRoles.slice(0,mafiaCount)];
    const citizenSlots = players.length - mafiaCount;
    const selectedCitizenRoles = [...baseCitizenRoles];
    if (citizenSlots >= 15) selectedCitizenRoles.push(...extraCitizenRoles);
    else if (citizenSlots >= 13) selectedCitizenRoles.push("예언자","복수자");
    else if (citizenSlots >= 12) selectedCitizenRoles.push("예언자");
    roles.push(...selectedCitizenRoles.slice(0, citizenSlots));
    while (roles.length < players.length) roles.push("일반 시민");
    // Always use a single mafia boss and fill remaining mafia slots.
    shuffled.forEach((p,i)=>{
      p.role=roles[i]; p.alive=true; p.zone="중앙 본부"; p.points=0; p.abilityUsed=0; p.missionDone=[];
      const pool = [
        "정보 수집가: 서로 다른 3명에게 질문하기",
        "보물 사냥꾼: 보물 토큰 3개 수집하기",
        "잠입 전문가: 서로 다른 미션 구역 3곳 방문하기",
        "협력자: 다른 참가자 2명과 협동 미션 수행하기",
        "생존왕: 3라운드 종료까지 생존하기",
        "위장 전문가: 게임 종료까지 직업을 맞히는 사람이 없게 하기",
        "암호 전달자: 암호 조각을 다른 참가자에게 전달하기"
      ];
      p.secretMission=pool[Math.floor(Math.random()*pool.length)];
    });
    room.status="playing"; room.phase="activity"; room.round=1;
    room.deadline=Date.now()+10*60*1000;
    room.missionsDone=new Set(); room.votes=new Map(); room.completed=[];
    announce(room,"게임 시작! 1차 활동 라운드가 시작되었습니다.");
    sendState(room);
    cb?.({ok:true});
  });

  socket.on("move", ({zone}, cb) => {
    const room=roomOf(socket), p=playerOf(room,socket);
    if (!room||!p||!p.alive||room.status!=="playing") return cb?.({error:"이동할 수 없습니다."});
    if (!ZONES.includes(zone)) return cb?.({error:"잘못된 구역입니다."});
    p.zone=zone;
    sendState(room); cb?.({ok:true});
  });

  socket.on("mission", ({missionId,answer}, cb) => {
    const room=roomOf(socket), p=playerOf(room,socket);
    if (!room||!p||!p.alive||room.status!=="playing") return cb?.({error:"미션을 수행할 수 없습니다."});
    const m=MISSIONS.find(x=>x.id===missionId);
    if (!m || p.missionDone.includes(missionId)) return cb?.({error:"미션을 찾을 수 없거나 이미 완료했습니다."});
    const requiredZone = {cipher:"암호 연구실",treasure:"보물 창고",team:"협동 훈련실",evidence:"정보실"}[missionId];
    if (p.zone!==requiredZone) return cb?.({error:`${requiredZone}에서만 수행할 수 있습니다.`});
    if (m.answer && String(answer||"").trim().toUpperCase()!==m.answer) return cb?.({error:"정답이 아닙니다."});
    if (missionId==="team") {
      const nearby=[...room.players.values()].filter(x=>x.alive&&x.zone===p.zone);
      if (nearby.length<3) return cb?.({error:"이 미션은 생존자 3명 이상이 같은 방에 있어야 합니다."});
    }
    p.missionDone.push(missionId); p.points+=m.points;
    room.missionsDone.add(missionId);
    room.completed.push({player:p.name,mission:m.title});
    announce(room,`${p.name}님이 미션을 완료했습니다.`);
    sendState(room); cb?.({ok:true});
  });

  socket.on("attack", ({targetId}, cb) => {
    const room=roomOf(socket), p=playerOf(room,socket), target=room?.players.get(targetId);
    if (!room||!p||!target||room.status!=="playing"||!p.alive||!mafiaRole(p.role)) return cb?.({error:"공격 권한이 없습니다."});
    if (!target.alive||mafiaRole(target.role)||target.id===p.id) return cb?.({error:"공격할 수 없는 대상입니다."});
    if (p.zone!==target.zone) return cb?.({error:"같은 구역에 있는 참가자만 공격할 수 있습니다."});
    if (["중앙 본부","안전구역"].includes(p.zone)) return cb?.({error:"이 구역에서는 공격할 수 없습니다."});
    if (room.lastAttackRound===room.round) return cb?.({error:"이번 라운드의 공격은 이미 사용되었습니다."});
    room.lastAttackRound=room.round;
    // Protection and special defenses are simplified for this starter.
    const guardian=[...room.players.values()].find(x=>x.alive&&x.role==="경호원"&&x.protectTarget===target.id);
    if (guardian) { guardian.alive=false; notice(room,target.id,"경호원이 당신을 대신해 공격을 받았습니다."); announce(room,`${target.name}님에 대한 공격이 경호원에 의해 막혔습니다.`); }
    else if (target.role==="군인"&&!target.abilityUsed) { target.abilityUsed++; notice(room,target.id,"군인 능력으로 공격을 방어했습니다."); announce(room,`${target.name}님이 공격을 방어했습니다.`); }
    else { target.alive=false; notice(room,target.id,"당신은 마피아의 공격으로 탈락했습니다."); announce(room,`${target.name}님이 탈락했습니다.`); }
    sendState(room); checkWin(room); cb?.({ok:true});
  });

  socket.on("protect", ({targetId}, cb) => {
    const room=roomOf(socket), p=playerOf(room,socket), target=room?.players.get(targetId);
    if (!room||!p||p.role!=="경호원"||!target||!p.alive) return cb?.({error:"경호원만 사용할 수 있습니다."});
    if (!target.alive||target.id===p.id) return cb?.({error:"보호할 수 없는 대상입니다."});
    p.protectTarget=target.id; cb?.({ok:true}); announce(room,`${p.name}님이 보호 대상을 지정했습니다.`);
  });

  socket.on("meeting", (_, cb) => {
    const room=roomOf(socket), p=playerOf(room,socket);
    if (!room||!p||!p.alive||room.status!=="playing") return cb?.({error:"회의를 시작할 수 없습니다."});
    if (p.zone!=="중앙 본부") return cb?.({error:"중앙 본부에서만 긴급 회의를 요청할 수 있습니다."});
    room.phase="meeting"; room.votes=new Map();
    announce(room,`${p.name}님이 긴급 회의를 요청했습니다. 투표를 시작합니다.`);
    sendState(room); cb?.({ok:true});
  });

  socket.on("vote", ({targetId}, cb) => {
    const room=roomOf(socket), p=playerOf(room,socket), target=room?.players.get(targetId);
    if (!room||room.phase!=="meeting"||!p||!p.alive||!target||!target.alive||target.id===p.id) return cb?.({error:"투표할 수 없습니다."});
    room.votes.set(socket.id,targetId);
    const voters=alivePlayers(room).length;
    if (room.votes.size>=voters) {
      const counts={};
      for (const [voterId,tid] of room.votes) {
        const voter=room.players.get(voterId);
        counts[tid]=(counts[tid]||0)+(voter?.role==="정치인"?2:1);
      }
      const max=Math.max(...Object.values(counts));
      const winners=Object.keys(counts).filter(id=>counts[id]===max);
      if (winners.length===1) {
        const out=room.players.get(winners[0]); out.alive=false;
        announce(room,`${out.name}님이 투표로 탈락했습니다. 직업은 ${out.role}입니다.`);
      } else announce(room,"투표가 동점입니다. 이번 회의에서는 아무도 탈락하지 않았습니다.");
      room.phase="activity"; room.round++; room.votes.clear();
      if (room.round>3) room.phase="final";
      checkWin(room);
    }
    sendState(room); cb?.({ok:true});
  });

  socket.on("chat", ({message,channel}, cb) => {
    const room=roomOf(socket), p=playerOf(room,socket);
    if (!room||!p||!p.alive) return cb?.({error:"채팅할 수 없습니다."});
    message=String(message||"").trim().slice(0,240);
    if (!message) return;
    const item={name:p.name,message,channel:channel==="mafia"&&mafiaRole(p.role)?"mafia":"public",at:Date.now()};
    for (const x of room.players.values()) {
      if (item.channel==="public" || (item.channel==="mafia"&&mafiaRole(x.role))) io.to(x.id).emit("chat",item);
    }
    cb?.({ok:true});
  });

  socket.on("finalCode", ({answer}, cb) => {
    const room=roomOf(socket), p=playerOf(room,socket);
    if (!room||!p||!p.alive||room.phase!=="final") return cb?.({error:"최종 탈출 단계가 아닙니다."});
    if (room.missionsDone.size<4) return cb?.({error:"시민팀 전체가 네 가지 미션을 모두 완료해야 합니다."});
    if (String(answer||"").trim()!=="7294") return cb?.({error:"탈출 코드가 틀렸습니다."});
    endGame(room,"시민팀","최종 탈출 코드 입력에 성공했습니다.");
    cb?.({ok:true});
  });

  socket.on("hostEnd", (_, cb) => {
    const room=roomOf(socket);
    if (!room||room.hostId!==socket.id) return cb?.({error:"방장만 종료할 수 있습니다."});
    endGame(room,"진행자 종료","방장이 게임을 종료했습니다."); cb?.({ok:true});
  });

  socket.on("disconnect", () => {
    const room=roomOf(socket);
    if (!room) return;
    const p=room.players.get(socket.id);
    if (p && room.status==="lobby") room.players.delete(socket.id);
    else if (p && room.status==="playing") p.connected=false;
    if (room.players.size===0) rooms.delete(room.id);
    else sendState(room);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`DEAD ZONE ONLINE running on port ${PORT}`));