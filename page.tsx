"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type Profile = { name: string; bio: string; avatar: string };
type Chat = { name: string; text: string };

export default function Home() {
  const [name, setName] = useState("CHICO"),
    [bio, setBio] = useState("online e pronto pra fofoca"),
    [avatar, setAvatar] = useState("");
  const [room, setRoom] = useState("FOFOCA"),
    [joined, setJoined] = useState(false),
    [profile, setProfile] = useState(false),
    [pendingJoin, setPendingJoin] = useState(false),
    [muted, setMuted] = useState(true),
    [camera, setCamera] = useState(false),
    [sharing, setSharing] = useState(false),
    [recording, setRecording] = useState(false),
    [participants, setParticipants] = useState(1),
    [toast, setToast] = useState("");
  const [messages, setMessages] = useState<Chat[]>([
      { name: "saiufofoca", text: "Sala criada. Manda o código pra galera 👀" },
    ]),
    [message, setMessage] = useState(""),
    [remoteIds, setRemoteIds] = useState<string[]>([]);
  const socket = useRef<Socket | null>(null),
    localStream = useRef<MediaStream | null>(null),
    localVideo = useRef<HTMLVideoElement>(null),
    peers = useRef(new Map<string, RTCPeerConnection>()),
    remoteStreams = useRef(new Map<string, MediaStream>()),
    recorder = useRef<MediaRecorder | null>(null),
    chunks = useRef<Blob[]>([]);
  useEffect(() => {
    const s = localStorage.getItem("sf-profile");
    if (s) {
      const p = JSON.parse(s);
      setName(p.name);
      setBio(p.bio);
      setAvatar(p.avatar);
    }
  }, []);
  const note = (t: string) => {
      setToast(t);
      setTimeout(() => setToast(""), 2000);
    },
    initials = name.slice(0, 2).toUpperCase();
  const save = () => {
    if (!name.trim()) return note("Digite seu nome");
    localStorage.setItem("sf-profile", JSON.stringify({ name, bio, avatar }));
    setProfile(false);
    if (pendingJoin) {
      setPendingJoin(false);
      setJoined(true);
    }
    note("Perfil atualizado!");
  };
  const photo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setAvatar(String(r.result));
    r.readAsDataURL(f);
  };
  const makePeer = (id: string, initiator: boolean) => {
    if (peers.current.has(id)) return peers.current.get(id)!;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    peers.current.set(id, pc);
    localStream.current
      ?.getTracks()
      .forEach((t) => pc.addTrack(t, localStream.current!));
    pc.onicecandidate = (e) => {
      if (e.candidate)
        socket.current?.emit("signal", {
          to: id,
          data: { candidate: e.candidate },
        });
    };
    pc.ontrack = (e) => {
      remoteStreams.current.set(id, e.streams[0]);
      setRemoteIds([...remoteStreams.current.keys()]);
    };
    if (initiator)
      pc.createOffer().then((o) =>
        pc
          .setLocalDescription(o)
          .then(() =>
            socket.current?.emit("signal", {
              to: id,
              data: { description: pc.localDescription },
            }),
          ),
      );
    return pc;
  };
  const share = async () => {
    if (sharing) {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = cam.getVideoTracks()[0];
      peers.current.forEach((pc) =>
        pc
          .getSenders()
          .find((s) => s.track?.kind === "video")
          ?.replaceTrack(track),
      );
      localStream.current?.getVideoTracks().forEach((t) => {
        t.stop();
        localStream.current?.removeTrack(t);
      });
      localStream.current?.addTrack(track);
      if (localVideo.current)
        localVideo.current.srcObject = localStream.current;
      setSharing(false);
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const track = display.getVideoTracks()[0];
      peers.current.forEach((pc) =>
        pc
          .getSenders()
          .find((s) => s.track?.kind === "video")
          ?.replaceTrack(track),
      );
      track.onended = () => share();
      setSharing(true);
    } catch {
      note("Compartilhamento cancelado");
    }
  };
  const recordCall = async () => {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      note("Gravação finalizada");
      return;
    }
    if (
      !window.confirm(
        "Antes de gravar, confirme que todos na chamada concordaram com a gravação.",
      )
    )
      return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      chunks.current = [];
      const type = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const mr = new MediaRecorder(stream, { mimeType: type });
      recorder.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: "video/webm" }),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = `saiufofoca-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      mr.start(1000);
      setRecording(true);
      note("Gravação iniciada");
    } catch {
      note("Não foi possível iniciar a gravação");
    }
  };
  const requestJoin = () => {
    if (!room.trim()) return note("Digite um código");
    setPendingJoin(true);
    setProfile(true);
  };
  const newRoom = () => {
    setRoom(Math.random().toString(36).slice(2, 8).toUpperCase());
    setPendingJoin(true);
    setProfile(true);
  };
  useEffect(() => {
    if (!joined) return;
    let active = true;
    const start = async () => {
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
        }
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.getAudioTracks().forEach((t) => (t.enabled = false));
        stream.getVideoTracks().forEach((t) => (t.enabled = false));
        localStream.current = stream;
        if (localVideo.current) localVideo.current.srcObject = stream;
        const url =
          process.env.NEXT_PUBLIC_SIGNALING_URL ||
          "https://saiufofoca-server.onrender.com";
        const s = io(url, { transports: ["websocket", "polling"] });
        socket.current = s;
        s.on("connect", () =>
          s.emit("join-room", { room, profile: { name, bio, avatar } }),
        );
        s.on("room-peers", (list: { id: string; profile: Profile }[]) =>
          list.forEach((p) => makePeer(p.id, true)),
        );
        s.on("peer-joined", ({ id }: { id: string }) => makePeer(id, false));
        s.on(
          "signal",
          async ({
            from,
            data,
          }: {
            from: string;
            data: {
              description?: RTCSessionDescriptionInit;
              candidate?: RTCIceCandidateInit;
            };
          }) => {
            const pc = makePeer(from, false);
            if (data.description) {
              await pc.setRemoteDescription(data.description);
              if (data.description.type === "offer") {
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                s.emit("signal", {
                  to: from,
                  data: { description: pc.localDescription },
                });
              }
            }
            if (data.candidate) await pc.addIceCandidate(data.candidate);
          },
        );
        s.on("peer-left", (id: string) => {
          peers.current.get(id)?.close();
          peers.current.delete(id);
          remoteStreams.current.delete(id);
          setRemoteIds([...remoteStreams.current.keys()]);
        });
        s.on("room-count", setParticipants);
        s.on("chat-message", (m: Chat) => setMessages((old) => [...old, m]));
        s.on("connect_error", () => note("Servidor da chamada indisponível"));
      } catch {
        note("Permita o uso do microfone e da câmera");
        setJoined(false);
      }
    };
    start();
    return () => {
      active = false;
      socket.current?.disconnect();
      socket.current = null;
      peers.current.forEach((p) => p.close());
      peers.current.clear();
      remoteStreams.current.clear();
      localStream.current?.getTracks().forEach((t) => t.stop());
      localStream.current = null;
      setRemoteIds([]);
    };
  }, [joined, room]);
  return (
    <main className="app">
      {toast && <div className="toast">{toast}</div>}
      <aside className="rail">
        <button className="logo" onClick={() => setJoined(false)}>
          sf
        </button>
        <hr />
        <button className="bubble">#</button>
        <button className="bubble plus" onClick={newRoom}>
          +
        </button>
      </aside>
      <aside className="side">
        <header>
          <b># sala {room}</b>
          <button onClick={() => setProfile(true)}>⚙</button>
        </header>
        <h6>CANAIS DE VÍDEO</h6>
        <button className="channel">
          <VideoIcon /> &nbsp; geral <span>1</span>
        </button>
        <div className="invite">
          <b>
            Convide amigos: envie o código
            <br />
            ou o link da sala.
          </b>
          <strong>{room}</strong>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(location.href + "?sala=" + room);
              note("Convite copiado!");
            }}
          >
            Copiar convite
          </button>
        </div>
        <button className="me" onClick={() => setProfile(true)}>
          <Avatar src={avatar} text={initials} />
          <span>
            <b>{name}</b>
            <small>#geral — sala {room}</small>
          </span>
          <MicOffIcon />
        </button>
      </aside>
      <section className="stage">
        <header>
          <b>#</b>
          <strong>geral</strong>
          <small>
            <i /> online
          </small>
          <button onClick={() => note("Link copiado!")}>⌁ Convidar</button>
        </header>
        <div className="screen">
          {!joined ? (
            <div className="welcome">
              <label>BEM-VINDO AO SAIUFOFOCA</label>
              <h1>
                Compartilhe a tela
                <br />
                com seus amigos.
              </h1>
              <p>Crie uma sala ou entre usando o código que recebeu.</p>
              <div>
                <input
                  value={room}
                  onChange={(e) => setRoom(e.target.value.toUpperCase())}
                  maxLength={10}
                />
                <button onClick={requestJoin}>Entrar na sala</button>
              </div>
              <button className="link" onClick={newRoom}>
                ou criar uma sala nova →
              </button>
            </div>
          ) : (
            <div className="video-grid">
              <div className="video-tile">
                <video ref={localVideo} autoPlay muted playsInline />
                <span>{name} (você)</span>
              </div>
              {remoteIds.map((id) => (
                <RemoteVideo key={id} stream={remoteStreams.current.get(id)!} />
              ))}
            </div>
          )}
          {joined && (
            <nav className="controls">
              <button
                className={muted ? "red" : ""}
                onClick={() => {
                  localStream.current
                    ?.getAudioTracks()
                    .forEach((t) => (t.enabled = muted));
                  setMuted(!muted);
                }}
                title="Microfone"
              >
                {muted ? <MicOffIcon /> : <MicIcon />}
              </button>
              <button
                className={!camera ? "red" : ""}
                onClick={() => {
                  localStream.current
                    ?.getVideoTracks()
                    .forEach((t) => (t.enabled = !camera));
                  setCamera(!camera);
                }}
                title="Câmera"
              >
                {camera ? <CameraIcon /> : <CameraOffIcon />}
              </button>
              <button
                className={sharing ? "on" : ""}
                onClick={share}
                title="Compartilhar tela"
              >
                <ScreenIcon />
              </button>
              <button
                className={recording ? "recording" : ""}
                onClick={recordCall}
                title={recording ? "Parar gravação" : "Gravar chamada"}
              >
                {recording ? <StopIcon /> : <RecordIcon />}
              </button>
              <button
                className="red"
                onClick={() => setJoined(false)}
                title="Sair da chamada"
              >
                <PhoneIcon />
              </button>
            </nav>
          )}
        </div>
      </section>
      <aside className="members">
        <header>
          <b>MEMBROS — {participants}</b>
          <span>•••</span>
        </header>
        <Member
          avatar={avatar}
          initials={initials}
          name={name + " (você)"}
          status={joined ? "na chamada" : bio}
        />
        <h6>CHAT DA SALA</h6>
        <div className="messages">
          {messages.map((m, i) => (
            <div key={i}>
              <b>{m.name}</b>
              <p>{m.text}</p>
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim()) {
              socket.current?.emit("chat-message", message.trim());
              setMessage("");
            }
          }}
        >
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`Conversar em #geral`}
          />
          <button>➤</button>
        </form>
      </aside>
      {profile && (
        <div
          className="backdrop"
          onMouseDown={() => {
            if (!pendingJoin) setProfile(false);
          }}
        >
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <button
              className="x"
              onClick={() => {
                setPendingJoin(false);
                setProfile(false);
              }}
            >
              ×
            </button>
            <label>{pendingJoin ? "ANTES DE ENTRAR" : "SEU ESPAÇO"}</label>
            <h2>
              {pendingJoin ? "Como você quer aparecer?" : "Personalizar perfil"}
            </h2>
            <p>Escolha seu nome, foto e status para a sala.</p>
            <label className="picker">
              <Avatar src={avatar} text={initials} />
              <span>
                <b>Escolher foto</b>
                <small>PNG ou JPG</small>
              </span>
              <input type="file" accept="image/*" onChange={photo} />
            </label>
            <Field title="Nome de exibição" value={name} set={setName} />
            <Field title="Status" value={bio} set={setBio} />
            <footer>
              <button
                onClick={() => {
                  setPendingJoin(false);
                  setProfile(false);
                }}
              >
                Cancelar
              </button>
              <button onClick={save}>
                {pendingJoin ? "Entrar na sala" : "Salvar mudanças"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="video-tile">
      <video ref={ref} autoPlay playsInline />
      <span>Participante</span>
    </div>
  );
}
function Avatar({ src, text }: { src?: string; text: string }) {
  return (
    <span className="avatar">{src ? <img src={src} alt="" /> : text}</span>
  );
}
function Member({
  avatar,
  initials,
  name,
  status,
}: {
  avatar?: string;
  initials: string;
  name: string;
  status: string;
}) {
  return (
    <div className="member">
      <Avatar src={avatar} text={initials} />
      <span>
        <b>{name}</b>
        <small>
          <i /> {status}
        </small>
      </span>
    </div>
  );
}
function Field({
  title,
  value,
  set,
}: {
  title: string;
  value: string;
  set: (s: string) => void;
}) {
  return (
    <label className="field">
      {title}
      <input value={value} onChange={(e) => set(e.target.value.slice(0, 45))} />
    </label>
  );
}
const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg
    className="line-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
function MicIcon() {
  return (
    <Svg>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
    </Svg>
  );
}
function MicOffIcon() {
  return (
    <Svg>
      <path d="m2 2 20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.6-1.5M17 16.7A7 7 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 11 5.7M12 19v3M8 22h8" />
    </Svg>
  );
}
function CameraIcon() {
  return (
    <Svg>
      <path d="M15 10l4.5-2.5v9L15 14M3 6h12v12H3z" />
    </Svg>
  );
}
function CameraOffIcon() {
  return (
    <Svg>
      <path d="m2 2 20 20M10.7 6H15v4.3M15 15.6V18H3V6h2.6M19.5 8l-4.5 2.5M19.5 16.5 17 15.1" />
    </Svg>
  );
}
function ScreenIcon() {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Svg>
  );
}
function RecordIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </Svg>
  );
}
function StopIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <rect
        x="8"
        y="8"
        width="8"
        height="8"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
    </Svg>
  );
}
function PhoneIcon() {
  return (
    <Svg>
      <path d="M6.6 10.8c1.5 3 3.8 5.2 6.6 6.6l2.2-2.2c.4-.4.9-.5 1.4-.3l3.1 1.1c.6.2 1 .8 1 1.4V21c0 .6-.4 1-1 1C10.5 22 2 13.5 2 4c0-.6.4-1 1-1h3.6c.6 0 1.2.4 1.4 1l1.1 3.1c.2.5.1 1-.3 1.4z" />
    </Svg>
  );
}
function VideoIcon() {
  return (
    <Svg>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </Svg>
  );
}
function UsersIcon() {
  return (
    <Svg>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </Svg>
  );
}
