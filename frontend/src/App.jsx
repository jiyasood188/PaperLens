import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  BookmarkPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileClock,
  FileCheck2,
  FileText,
  FlaskConical,
  FolderOpen,
  Gauge,
  Layers3,
  LoaderCircle,
  MessageCircle,
  Menu,
  Microscope,
  Network,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const WORKSPACE_STORAGE_KEY = "paperlens.team-workspace.v1";

function isStoredProject(project) {
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const isDate = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
  return isObject(project)
    && typeof project.id === "string"
    && typeof project.title === "string"
    && isObject(project.result)
    && typeof project.notes === "string"
    && isDate(project.createdAt)
    && isDate(project.updatedAt)
    && Array.isArray(project.members)
    && project.members.every((member) => isObject(member) && typeof member.name === "string" && typeof member.email === "string" && typeof member.role === "string" && typeof member.initials === "string")
    && Array.isArray(project.comments)
    && project.comments.every((comment) => isObject(comment) && typeof comment.id === "string" && typeof comment.text === "string" && typeof comment.author === "string" && isDate(comment.createdAt))
    && Array.isArray(project.activity)
    && project.activity.every((item) => isObject(item) && typeof item.id === "string" && typeof item.actor === "string" && typeof item.action === "string" && typeof item.detail === "string" && isDate(item.createdAt))
    && Array.isArray(project.versions)
    && project.versions.every((version) => isObject(version) && typeof version.id === "string" && typeof version.label === "string" && typeof version.notes === "string" && typeof version.author === "string" && isDate(version.createdAt));
}

function readWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) || "[]");
    if (!Array.isArray(saved) || !saved.every(isStoredProject)) {
      return { projects: [], error: "Saved workspace data is invalid and could not be loaded." };
    }
    return { projects: saved, error: "" };
  } catch {
    return { projects: [], error: "Saved workspace data could not be read from this browser." };
  }
}

function makeActivity(actor, action, detail = "") {
  return { id: `${Date.now()}-${Math.random()}`, actor, action, detail, createdAt: new Date().toISOString() };
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const fileInput = useRef(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [activeSection, setActiveSection] = useState("Overview");
  const [createWorkspaceOnAnalysis, setCreateWorkspaceOnAnalysis] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [workspaceState, setWorkspaceState] = useState(readWorkspace);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [storageError, setStorageError] = useState(workspaceState.error);
  const projects = workspaceState.projects;
  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  const saveProjects = (nextProjects) => {
    setWorkspaceState({ projects: nextProjects, error: "" });
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(nextProjects));
      setStorageError("");
    } catch {
      setStorageError("Changes are visible for this session but could not be saved in this browser.");
    }
  };

  const createProject = (analysis, sourceFile) => {
    if (!analysis) return;
    const now = new Date().toISOString();
    const project = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: analysis.paper_title || sourceFile?.name || "Untitled paper",
      result: analysis,
      notes: "",
      createdAt: now,
      updatedAt: now,
      members: [{ name: "You", email: "you@research-lab.local", role: "Owner", initials: "RL" }],
      comments: [],
      activity: [makeActivity("You", "created this paper workspace", "Initial analysis saved as version 1.")],
      versions: [{ id: `${Date.now()}-v1`, label: "Initial analysis", notes: "", createdAt: now, author: "You" }],
    };
    saveProjects([project, ...projects]);
    setSelectedProjectId(project.id);
    setActiveSection("Workspace");
    setCreateWorkspaceOnAnalysis(false);
  };

  const saveAnalysisToWorkspace = () => createProject(result, file);

  const updateProject = (projectId, transform) => {
    saveProjects(projects.map((project) => project.id === projectId ? transform(project) : project));
  };

  const selectFile = (selected) => {
    if (!selected) return;
    setError("");
    setResult(null);
    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) {
      setFile(null);
      setError("Please choose a PDF file to analyze.");
      return;
    }
    if (selected.size > 25 * 1024 * 1024) {
      setFile(null);
      setError("This file is larger than the 25 MB upload limit.");
      return;
    }
    setFile(selected);
  };

  const analyze = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch(`${API_URL}/api/analyze`, { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Analysis failed (HTTP ${response.status}).`);
      setResult(data);
      if (createWorkspaceOnAnalysis) {
        createProject(data, file);
      } else {
        setActiveSection("Overview");
      }
    } catch (issue) {
      setError(issue.message || "Could not connect to PaperLens. Check that the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  const downloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(result.paper_title || file?.name || "paperlens-analysis").replace(/[<>:"/\\|?*]+/g, "_")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError("");
    setCreateWorkspaceOnAnalysis(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const navItems = [
    { label: "Overview", icon: Layers3 },
    { label: "Methodology", icon: Microscope },
    { label: "Datasets", icon: Network },
    { label: "Metrics", icon: Gauge },
  ];

  const metricCount = result?.metrics?.length || 0;
  const datasetCount = result?.datasets?.length || 0;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><BookOpen size={19} strokeWidth={2.2} /></div>
          <div>
            <div className="brand-name">Paper<span>Lens</span></div>
            <div className="brand-caption">RESEARCH INTELLIGENCE</div>
          </div>
          <button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={17} /></button>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-select"><span className="workspace-avatar">R</span><span className="workspace-copy"><strong>Research lab</strong><small>Personal workspace</small></span><ChevronDown size={15} /></button>

        <div className="nav-heading">WORKSPACE</div>
        <nav className="nav-list" aria-label="Workspace navigation">
          <button className={`nav-item ${activeSection === "Workspace" ? "nav-active" : ""}`} onClick={() => { setCreateWorkspaceOnAnalysis(false); setActiveSection("Workspace"); setMobileNav(false); }}>
            <Users size={17} /><span>Team workspace</span>{projects.length > 0 && <span className="nav-count">{projects.length}</span>}
          </button>
        </nav>

        <div className="nav-heading">ANALYSIS</div>
        <nav className="nav-list" aria-label="Analysis sections">
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${activeSection === label ? "nav-active" : ""}`} onClick={() => { setCreateWorkspaceOnAnalysis(false); setActiveSection(label); setMobileNav(false); }}>
              <Icon size={17} /><span>{label}</span>
              {label === "Metrics" && result && <span className="nav-count">{metricCount}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-card"><ShieldAlert size={16} /><div><strong>Local-first workspace</strong><span>Projects stay in this browser. Live sharing is not enabled.</span></div></div>
          <a className="help-link" href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer"><CircleHelp size={16} /> API documentation <ArrowUpRight size={13} /></a>
          <div className="sidebar-version"><span className="status-dot" /> Local workspace <span>v1.0</span></div>
        </div>
      </aside>

      {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="Close navigation overlay" />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="breadcrumb"><span>PaperLens</span><span className="crumb-slash">/</span><strong>{activeSection === "Workspace" ? "Team workspace" : activeSection}</strong></div>
          <div className="topbar-right"><span className="local-indicator"><span className="status-dot" /> Local &amp; secure</span><div className="avatar">RL</div></div>
        </header>

        <div className="content">
          <section className="page-heading">
            <div>
              <div className="eyebrow"><Sparkles size={13} /> {activeSection === "Workspace" ? "SHARED RESEARCH SPACE" : "PAPER ANALYSIS"}</div>
              <h1>{activeSection === "Workspace" ? <>Research, <span>together.</span></> : <>Research, <span>understood.</span></>}</h1>
              <p>{activeSection === "Workspace" ? "Keep your team's reading, notes, and decisions in one place." : "Turn dense research papers into clear, structured insights."}</p>
            </div>
            {result && <button className="button button-secondary export-button" onClick={downloadJson}><ArrowDownToLine size={16} /> Export JSON</button>}
          </section>

          {storageError && <div className="alert alert-error storage-alert"><ShieldAlert size={16} /><span>{storageError}</span></div>}
          {activeSection === "Workspace" ? (
            <WorkspaceView
              projects={projects}
              project={selectedProject}
              onSelectProject={setSelectedProjectId}
              onNewAnalysis={() => {
                setFile(null);
                setResult(null);
                setError("");
                setSelectedProjectId(null);
                setCreateWorkspaceOnAnalysis(true);
                setActiveSection("Overview");
                if (fileInput.current) fileInput.current.value = "";
              }}
              onUpdateProject={updateProject}
            />
          ) : !result ? (
            <section className="upload-layout">
              <div className="upload-card panel">
                <div className="section-title-row">
                  <div className="section-icon purple-icon"><FileCheck2 size={18} /></div>
                  <div><h2>{createWorkspaceOnAnalysis ? "Create a team workspace" : "Analyze a research paper"}</h2><p>{createWorkspaceOnAnalysis ? "Analyze a PDF and open its research project with contributor options." : "Upload a PDF to extract its key research insights."}</p></div>
                  <span className="step-pill">01 <span>/ 01</span></span>
                </div>
                <div
                  className={`dropzone ${dragging ? "dropzone-active" : ""} ${file ? "dropzone-file" : ""}`}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]); }}
                >
                  <input ref={fileInput} type="file" accept=".pdf,application/pdf" hidden onChange={(event) => selectFile(event.target.files[0])} />
                  {file ? (
                    <div className="selected-file">
                      <div className="file-icon"><FileText size={23} /></div>
                      <div className="file-details"><strong>{file.name}</strong><span>PDF document · {formatBytes(file.size)}</span></div>
                      <button className="icon-button remove-file" onClick={() => { setFile(null); setResult(null); }} aria-label="Remove selected file"><X size={17} /></button>
                    </div>
                  ) : (
                    <>
                      <div className="upload-icon"><Upload size={20} /></div>
                      <h3>Drop your paper here</h3>
                      <p>or <button className="text-button" onClick={() => fileInput.current?.click()}>browse files</button> from your computer</p>
                      <div className="file-hint"><span>PDF only</span><span className="hint-divider" /> Up to 25 MB</div>
                    </>
                  )}
                </div>
                {error && <div className="alert alert-error"><ShieldAlert size={16} /><span>{error}</span><button className="icon-button" onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
                <div className="upload-footer">
                  <div className="secure-note"><ShieldAlert size={15} /><span>Your file is analyzed in memory and is never saved.</span></div>
                  <button className="button button-primary analyze-button" onClick={analyze} disabled={!file || loading}>
                    {loading ? <><LoaderCircle className="spin" size={16} /> Analyzing paper…</> : <><Sparkles size={16} /> {createWorkspaceOnAnalysis ? "Analyze & create workspace" : "Analyze paper"} <ArrowUpRight size={15} /></>}
                  </button>
                </div>
              </div>
              <aside className="how-card panel">
                <div className="how-heading"><div className="section-icon teal-icon"><Activity size={17} /></div><div><h2>What you’ll get</h2><p>A structured research brief</p></div></div>
                <div className="feature-list">
                  <Feature icon={FileText} title="Paper summary" detail="Core contribution, in a few sentences" color="blue" />
                  <Feature icon={FlaskConical} title="Methodology" detail="Approach, models, and experiments" color="purple" />
                  <Feature icon={Gauge} title="Benchmark metrics" detail="Reported scores with context" color="teal" />
                  <Feature icon={CheckCircle2} title="Verification notes" detail="Details to double-check manually" color="amber" />
                </div>
                <div className="pipeline-note"><Sparkles size={14} /><span>Runs locally with rule-based extraction. No cloud API key or external AI service is needed.</span></div>
              </aside>
            </section>
          ) : (
            <AnalysisResult result={result} file={file} activeSection={activeSection} onTabChange={setActiveSection} metricCount={metricCount} datasetCount={datasetCount} onReset={reset} onSaveToWorkspace={saveAnalysisToWorkspace} />
          )}

          <footer className="page-footer"><span>PaperLens <span className="footer-dot">·</span> Research intelligence for everyone</span><span>Made for careful reading <BookOpen size={13} /></span></footer>
        </div>
      </main>
    </div>
  );
}

function WorkspaceView({ projects, project, onSelectProject, onNewAnalysis, onUpdateProject }) {
  const [noteDraft, setNoteDraft] = useState(project?.notes || "");
  const [commentDraft, setCommentDraft] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setNoteDraft(project?.notes || "");
    setFormError("");
  }, [project?.id, project?.notes]);

  const saveNotes = (event) => {
    event.preventDefault();
    if (!project || noteDraft === project.notes) return;
    const now = new Date().toISOString();
    onUpdateProject(project.id, (current) => ({
      ...current,
      notes: noteDraft,
      updatedAt: now,
      versions: [...current.versions, {
        id: `${Date.now()}-v${current.versions.length + 1}`,
        label: `Research notes v${current.versions.length + 1}`,
        notes: noteDraft,
        createdAt: now,
        author: "You",
      }],
      activity: [makeActivity("You", "saved a research-notes version", `Version ${current.versions.length + 1} added to history.`), ...current.activity],
    }));
  };

  const addComment = (event) => {
    event.preventDefault();
    const text = commentDraft.trim();
    if (!project || !text) return;
    const now = new Date().toISOString();
    const comment = { id: `${Date.now()}-comment`, text, author: "You", createdAt: now };
    onUpdateProject(project.id, (current) => ({
      ...current,
      updatedAt: now,
      comments: [...current.comments, comment],
      activity: [makeActivity("You", "left a comment", text), ...current.activity],
    }));
    setCommentDraft("");
  };

  const addMember = (event) => {
    event.preventDefault();
    const email = memberEmail.trim().toLowerCase();
    if (!project || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("Enter a valid email address.");
      return;
    }
    if (project.members.some((member) => member.email.toLowerCase() === email)) {
      setFormError("That person is already on this workspace.");
      return;
    }
    const now = new Date().toISOString();
    const name = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    onUpdateProject(project.id, (current) => ({
      ...current,
      updatedAt: now,
      members: [...current.members, { name, email, role: "Contributor", initials: name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() }],
      activity: [makeActivity("You", "added a local contributor", email), ...current.activity],
    }));
    setMemberEmail("");
    setFormError("");
  };

  const restoreVersion = (version) => {
    const now = new Date().toISOString();
    onUpdateProject(project.id, (current) => ({
      ...current,
      notes: version.notes,
      updatedAt: now,
      versions: [...current.versions, {
        id: `${Date.now()}-restore`,
        label: `Restored ${version.label}`,
        notes: version.notes,
        createdAt: now,
        author: "You",
      }],
      activity: [makeActivity("You", "restored a notes version", version.label), ...current.activity],
    }));
    setNoteDraft(version.notes);
  };

  if (!project) {
    return (
      <section className="workspace-empty panel">
        <div className="workspace-empty-icon"><Users size={24} /></div>
        <div className="eyebrow">YOUR RESEARCH HUB</div>
        <h2>{projects.length ? "Choose a paper workspace" : "Bring your research team together."}</h2>
        <p>{projects.length ? "Select a saved paper to continue reviewing its notes, activity, and versions." : "Save an analysis to create a paper workspace with notes, discussion, contributors, and a recoverable change history."}</p>
        {projects.length > 0 && (
          <div className="project-list">
            {projects.map((item) => (
              <button className="project-list-item panel" key={item.id} onClick={() => onSelectProject(item.id)}>
                <div className="project-list-icon"><FileText size={17} /></div>
                <span className="project-list-copy"><strong>{item.title}</strong><small>{item.members.length} contributor{item.members.length === 1 ? "" : "s"} · updated {formatDate(item.updatedAt)}</small></span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        )}
        <button className="button button-primary" onClick={onNewAnalysis}><Plus size={15} /> Analyze a paper</button>
        <div className="local-only-note"><ShieldAlert size={14} /> Local prototype: workspaces are saved only in this browser. Invites and live multi-user editing are not enabled.</div>
      </section>
    );
  }

  return (
    <div className="workspace-view">
      <div className="workspace-toolbar">
        <button className="back-link" onClick={() => onSelectProject(null)}><ArrowUpRight size={14} /> All papers</button>
        <span className="local-workspace-badge"><span className="status-dot" /> Local workspace</span>
      </div>
      <section className="project-hero panel">
        <div className="project-hero-icon"><FileText size={20} /></div>
        <div className="project-hero-copy">
          <div className="result-label">PAPER WORKSPACE · {project.result.year || "YEAR NOT IDENTIFIED"}</div>
          <h2>{project.title}</h2>
          <p>{project.result.author || "Research team"} · {project.result.page_count || "—"} pages · {project.result.datasets?.length || 0} datasets identified</p>
        </div>
        <div className="member-stack" aria-label={`${project.members.length} contributors`}>
          {project.members.slice(0, 4).map((member, index) => <span className={`member-avatar member-color-${index % 4}`} title={member.email} key={member.email}>{member.initials}</span>)}
          {project.members.length > 4 && <span className="member-overflow">+{project.members.length - 4}</span>}
        </div>
      </section>

      <div className="collab-grid">
        <div className="collab-main">
          <section className="panel collab-card">
            <div className="card-heading"><div className="section-icon purple-icon"><FileCheck2 size={17} /></div><div><h2>Research notes</h2><p>Capture your team's interpretation and next steps</p></div><span className="version-pill">v{project.versions.length}</span></div>
            <form onSubmit={saveNotes}>
              <textarea className="notes-editor" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="What are the paper's key takeaways? Add limitations, questions, or ideas to follow up…" aria-label="Shared research notes" />
              <div className="notes-footer"><span>Every save creates a restorable version.</span><button className="button button-primary" type="submit" disabled={noteDraft === project.notes}><FileClock size={14} /> Save version</button></div>
            </form>
          </section>

          <section className="panel collab-card">
            <div className="card-heading"><div className="section-icon teal-icon"><MessageCircle size={17} /></div><div><h2>Team discussion</h2><p>{project.comments.length} comment{project.comments.length === 1 ? "" : "s"} on this paper</p></div></div>
            <div className="comment-list">
              {project.comments.length ? project.comments.map((comment) => (
                <article className="comment-item" key={comment.id}><span className="comment-avatar">{comment.author === "You" ? "RL" : comment.author.slice(0, 2).toUpperCase()}</span><div><div className="comment-meta"><strong>{comment.author}</strong><time>{formatDate(comment.createdAt)}</time></div><p>{comment.text}</p></div></article>
              )) : <div className="empty-discussion">Start a discussion about the findings, methods, or metrics.</div>}
            </div>
            <form className="comment-form" onSubmit={addComment}>
              <input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Add a thought or question…" aria-label="Add a comment" maxLength={1000} />
              <button className="button button-secondary" type="submit" disabled={!commentDraft.trim()}><MessageCircle size={14} /> Comment</button>
            </form>
          </section>
        </div>

        <aside className="collab-aside">
          <section className="panel collab-card">
            <div className="card-heading"><div className="section-icon blue-icon"><Users size={17} /></div><div><h2>Contributors</h2><p>{project.members.length} on this local workspace</p></div></div>
            <div className="contributor-list">{project.members.map((member, index) => <div className="contributor-row" key={member.email}><span className={`member-avatar member-color-${index % 4}`}>{member.initials}</span><div><strong>{member.name}</strong><small>{member.email}</small></div><span className="role-tag">{member.role}</span></div>)}</div>
            <form className="invite-form" onSubmit={addMember}><label htmlFor="contributor-email">Add a contributor</label><div><input id="contributor-email" type="email" value={memberEmail} onChange={(event) => { setMemberEmail(event.target.value); setFormError(""); }} placeholder="name@lab.org" /><button className="icon-button invite-button" type="submit" aria-label="Add contributor"><UserPlus size={16} /></button></div>{formError && <span className="form-error">{formError}</span>}</form>
            <p className="invite-disclaimer">Prototype only: adding an email records it here but does not send an invitation.</p>
          </section>

          <section className="panel collab-card history-card">
            <div className="card-heading"><div className="section-icon amber-icon"><Clock3 size={17} /></div><div><h2>Version history</h2><p>{project.versions.length} saved version{project.versions.length === 1 ? "" : "s"}</p></div></div>
            <div className="version-list">{[...project.versions].reverse().map((version, index) => <div className="version-item" key={version.id}><span className={`version-marker ${index === 0 ? "latest" : ""}`} /><div className="version-copy"><strong>{version.label}</strong><small>{version.author} · {formatDate(version.createdAt)}</small>{index !== 0 && <button className="restore-link" onClick={() => restoreVersion(version)}>Restore this version</button>}</div></div>)}</div>
          </section>

          <section className="panel collab-card activity-card">
            <div className="card-heading"><div className="section-icon teal-icon"><Activity size={17} /></div><div><h2>Recent activity</h2><p>Changes in this workspace</p></div></div>
            <div className="activity-list">{project.activity.map((item) => <div className="activity-item" key={item.id}><span className="activity-dot" /><div><p><strong>{item.actor}</strong> {item.action}</p>{item.detail && <small>{item.detail}</small>}<time>{formatDate(item.createdAt)}</time></div></div>)}</div>
          </section>
        </aside>
      </div>
      <div className="local-only-note"><ShieldAlert size={14} /> This prototype stores workspace data in this browser only. Contributors cannot see changes from another device or browser.</div>
    </div>
  );
}

function Feature({ icon: Icon, title, detail, color }) {
  return <div className="feature-item"><div className={`feature-icon ${color}`}><Icon size={16} /></div><div><strong>{title}</strong><span>{detail}</span></div><Check size={15} className="feature-check" /></div>;
}

function AnalysisResult({ result, file, activeSection, onTabChange, metricCount, datasetCount, onReset, onSaveToWorkspace }) {
  const tabs = ["Overview", "Methodology", "Datasets", "Metrics"];

  return (
    <>
      <div className="result-paper panel">
        <div className="result-paper-icon"><FileText size={20} /></div>
        <div className="result-paper-info"><div className="result-label">ANALYZED PAPER</div><h2>{result.paper_title || file?.name || "Untitled paper"}</h2><div className="paper-meta"><span>{result.page_count} pages</span><span className="meta-dot" />{result.author ? <><span>{result.author}</span><span className="meta-dot" /></> : null}<span>{result.year || "Year not identified"}</span><span className="meta-dot" /><span className="source-badge"><Activity size={11} /> Local extraction</span></div></div>
        <button className="button button-secondary save-workspace-button" onClick={onSaveToWorkspace}><BookmarkPlus size={14} /> Save to workspace</button>
        <button className="button button-secondary compact-button" onClick={onReset}><RotateCcw size={14} /> New analysis</button>
      </div>
      <div className="result-tabs" role="tablist" aria-label="Analysis views">
        {tabs.map((tab) => <button key={tab} role="tab" aria-selected={activeSection === tab} className={activeSection === tab ? "result-tab selected-tab" : "result-tab"} onClick={() => onTabChange(tab)}>{tab}{tab === "Metrics" && <span className="tab-count">{metricCount}</span>}</button>)}
      </div>
      <ResultSections result={result} activeSection={activeSection} datasetCount={datasetCount} />
    </>
  );
}

function ResultSections({ result, activeSection, datasetCount }) {
  const methodology = result.methodology || {};
  const displaySummary = activeSection === "Overview";
  const displayMethod = activeSection === "Overview" || activeSection === "Methodology";
  const displayDatasets = activeSection === "Overview" || activeSection === "Datasets";
  const displayMetrics = activeSection === "Overview" || activeSection === "Metrics";
  const notes = result.verification_notes || [];
  return (
    <div className="results-grid">
      <div className="results-main">
        {displaySummary && <section className="panel result-card summary-card"><div className="card-heading"><div className="section-icon blue-icon"><BookOpen size={17} /></div><div><h2>Paper summary</h2><p>At a glance</p></div></div><p className="summary-text">{result.summary || "A concise summary could not be confidently extracted from this paper."}</p><div className="summary-foot"><span><Sparkles size={13} /> Extracted from paper text</span><span>{result.word_count?.toLocaleString() || "—"} words analyzed</span></div></section>}
        {displayMethod && <section className="panel result-card"><div className="card-heading"><div className="section-icon purple-icon"><Microscope size={17} /></div><div><h2>Methodology &amp; approach</h2><p>How the research was conducted</p></div></div><div className="method-block"><span className="field-label">PROPOSED APPROACH</span><p>{methodology.approach || "No explicit approach was confidently detected. Review the paper’s methods section."}</p></div><div className="method-divider" /><div className="method-block"><span className="field-label">EXPERIMENTAL METHODS</span><p>{methodology.experimental_methods || "No experimental methods were confidently detected."}</p></div><div className="method-chips">{(methodology.models || []).map((model) => <span className="method-chip" key={model}><Layers3 size={12} />{model}</span>)}{(!methodology.models || methodology.models.length === 0) && <span className="muted-inline">No model architecture identified</span>}</div></section>}
        {displayDatasets && <section className="panel result-card"><div className="card-heading"><div className="section-icon teal-icon"><Network size={17} /></div><div><h2>Datasets</h2><p>{datasetCount ? `${datasetCount} identified in the paper` : "Recognized benchmark and dataset names"}</p></div><span className="card-count">{datasetCount}</span></div>{datasetCount ? <div className="dataset-list">{result.datasets.map((dataset) => <div className="dataset-row" key={dataset.name}><div className="dataset-icon"><FolderOpen size={15} /></div><div className="dataset-name"><strong>{dataset.name}</strong>{dataset.context && <span>{dataset.context}</span>}</div><span className={`dataset-confidence ${dataset.confidence || "medium"}`}>{dataset.confidence || "medium"} confidence</span></div>)}</div> : <div className="empty-inline"><FolderOpen size={17} /> No dataset names were confidently detected.</div>}</section>}
        {displayMetrics && <section className="panel result-card"><div className="card-heading"><div className="section-icon teal-icon"><Gauge size={17} /></div><div><h2>Benchmark metrics</h2><p>Values detected in the paper text</p></div><span className="card-count">{result.metrics?.length || 0}</span></div>{result.metrics?.length ? <div className="metric-table-wrap"><table className="metric-table"><thead><tr><th>METRIC</th><th>VALUE</th><th>CONTEXT</th></tr></thead><tbody>{result.metrics.map((metric, index) => <tr key={`${metric.name}-${index}`}><td><strong>{metric.name}</strong></td><td><span className="metric-value">{metric.value}</span></td><td>{metric.context || "Reported value"}</td></tr>)}</tbody></table></div> : <div className="empty-inline"><Gauge size={17} /> No benchmark metric values were confidently detected.</div>}</section>}
      </div>
      <aside className="results-aside">
        <div className="panel quick-stats"><div className="aside-title">EXTRACTION SNAPSHOT</div><div className="stat-row"><span><Gauge size={15} /> Metrics found</span><strong>{result.metrics?.length || 0}</strong></div><div className="stat-row"><span><Network size={15} /> Datasets found</span><strong>{datasetCount}</strong></div><div className="stat-row"><span><FileText size={15} /> Pages processed</span><strong>{result.page_count || "—"}</strong></div><div className="quality-note"><span className="status-dot" /> Analysis complete</div></div>
        <div className="panel verification-card"><div className="verification-title"><div className="section-icon amber-icon"><ShieldAlert size={16} /></div><div><h3>Verify before citing</h3><span>{notes.length} review {notes.length === 1 ? "note" : "notes"}</span></div></div>{notes.length ? <ul>{notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul> : <p className="verification-clear"><CheckCircle2 size={14} /> No specific review notes were generated. Always verify extracted values against the source paper.</p>}</div>
        <div className="aside-tip"><CircleHelp size={15} /><p>PDF extraction can miss content in scanned pages, figures, and tables. Check reported values against the original paper.</p></div>
      </aside>
    </div>
  );
}

export default App;
