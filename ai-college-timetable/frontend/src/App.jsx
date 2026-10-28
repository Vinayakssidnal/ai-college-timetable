import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import "./App.css";

const API = "http://localhost:5000/api";
const TOKEN_KEY = "college-timetable-token";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PERIODS = [1, 2, 3, 4, 5, 6];
const TIMES = {
  1: "9.00–9.55",
  2: "9.55–10.50",
  3: "11.05–12.00",
  4: "1.45–2.40",
  5: "2.40–3.35",
  6: "3.35–4.30",
};
const BREAK_LABEL = "12.00–1.45";
const INITIAL_METADATA = {
  collegeName: "RAMAIAH INSTITUTE OF TECHNOLOGY",
  departmentName: "DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING",
  effectiveDate: "",
  academicYear: "2026–2027",
  term: "",
};
const DEFAULT_PREFERENCES = {
  labsAfterLunch: true,
  avoidRepeatedSubjectSameDay: true,
};

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sanitizeFilename(value) {
  return String(value || "timetable")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "timetable";
}

function dateLabel(value) {
  if (!value) return "—";
  const parts = String(value).split("-");
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : value;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseResponse(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    const extra = Array.isArray(result.errors) ? ` ${result.errors.join(" ")}` : "";
    throw new Error((result.message || `Request failed (${response.status}).`) + extra);
  }
  return result;
}

function cellText(entry, role) {
  if (!entry) return "";
  if (role === "teacher") {
    return `${entry.subject}\n${entry.className || entry.classId}\n${entry.room || ""}`;
  }
  return `${entry.subject}\n${entry.teacherName || entry.teacherId || ""}\n${entry.room || ""}`;
}

function compareEntries(a, b) {
  return DAYS.indexOf(a.day) - DAYS.indexOf(b.day) ||
    Number(a.period) - Number(b.period);
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [portalMode, setPortalMode] = useState("login"); // login | public | authenticated
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [collegeData, setCollegeData] = useState(null);
  const [timetable, setTimetable] = useState([]);
  const [aiRequirements, setAiRequirements] = useState(null);
  const [metadata, setMetadata] = useState(INITIAL_METADATA);
  const [prompt, setPrompt] = useState(
    "Generate a conflict-free timetable using the entered class, subject and teacher assignments. " +
    "Schedule labs after lunch and avoid repeating a subject on the same day."
  );
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [targetDay, setTargetDay] = useState("Wednesday");
  const [targetPeriod, setTargetPeriod] = useState("4");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [validation, setValidation] = useState(null);

  const [teacherForm, setTeacherForm] = useState({ id: "", name: "", weeklyWorkload: "16" });
  const [classForm, setClassForm] = useState({ id: "", name: "", semester: "5" });
  const [subjectForm, setSubjectForm] = useState({
    id: "", name: "", teacherId: "", periodsPerWeek: "3", type: "theory",
  });
  const [roomForm, setRoomForm] = useState({ id: "", type: "classroom" });

  const isCreator = user?.role === "creator";
  const isTeacher = user?.role === "teacher";
  const isPublic = portalMode === "public";
  const currentTeacherId = user?.teacherId || "";

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API}/auth/me`, { headers: authHeaders(token) });
        const result = await parseResponse(response);
        if (cancelled) return;
        setUser(result.user);
        setPortalMode("authenticated");
        await loadPortalData(token, result.user, cancelled);
      } catch {
        sessionStorage.removeItem(TOKEN_KEY);
        if (!cancelled) {
          setToken("");
          setUser(null);
          setPortalMode("login");
        }
      }
    })();
    return () => { cancelled = true; };
    // Intentionally runs once to restore the current login session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teacherOptions = collegeData?.teachers || [];
  const classOptions = collegeData?.classes || [];
  const roomOptions = collegeData?.rooms || [];

  useEffect(() => {
    if (!collegeData) return;
    if (classOptions.length && !classOptions.some((cls) => cls.id === selectedClassId)) {
      setSelectedClassId(classOptions[0].id);
    }
    if (teacherOptions.length && !teacherOptions.some((teacher) => teacher.id === selectedTeacherId)) {
      setSelectedTeacherId(isTeacher ? currentTeacherId : teacherOptions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collegeData, isTeacher, currentTeacherId]);

  const activeTeacherId = isTeacher ? currentTeacherId : selectedTeacherId;

  const viewEntries = useMemo(() => {
    if (isTeacher) {
      return timetable.filter((entry) => normalize(entry.teacherId) === normalize(currentTeacherId));
    }
    if (selectedClassId) {
      const selectedClass = classOptions.find((cls) => cls.id === selectedClassId);
      return timetable.filter((entry) =>
        normalize(entry.classId) === normalize(selectedClassId) ||
        normalize(entry.className) === normalize(selectedClass?.name)
      );
    }
    return timetable;
  }, [timetable, isTeacher, currentTeacherId, selectedClassId, classOptions]);

  const viewTitle = useMemo(() => {
    if (isTeacher) return `${user?.displayName || currentTeacherId} — Teacher Timetable`;
    if (selectedClassId) {
      const cls = classOptions.find((item) => item.id === selectedClassId);
      return cls ? `${cls.name} — Semester ${cls.semester}` : "Class Timetable";
    }
    return "College Timetable";
  }, [isTeacher, user, currentTeacherId, selectedClassId, classOptions]);

  const visibleDays = useMemo(() => {
    const found = new Set(viewEntries.map((entry) => entry.day).filter(Boolean));
    return DAYS.filter((day) => found.has(day)).concat(
      [...found].filter((day) => !DAYS.includes(day))
    ).length ? DAYS.filter((day) => found.has(day)).concat([...found].filter((day) => !DAYS.includes(day))) : DAYS;
  }, [viewEntries]);

  const allSessions = useMemo(() => {
    const grouped = new Map();
    for (const entry of timetable) {
      const key = [entry.classId, entry.subjectId, entry.day, entry.room].join("|");
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(entry);
    }
    const sessions = [];
    for (const entries of grouped.values()) {
      entries.sort((a, b) => Number(a.period) - Number(b.period));
      let block = [];
      for (const entry of entries) {
        if (block.length && Number(entry.period) !== Number(block[block.length - 1].period) + 1) {
          sessions.push(block);
          block = [];
        }
        block.push(entry);
      }
      if (block.length) sessions.push(block);
    }
    return sessions.map((entries) => {
      const first = entries[0];
      const last = entries[entries.length - 1];
      return {
        key: `${first.classId}|${first.subjectId}|${first.day}|${first.period}`,
        entry: first,
        duration: entries.length,
        label: `${first.className || first.classId} · ${first.subject} · ${first.day} P${first.period}${entries.length > 1 ? `–P${last.period}` : ""}`,
      };
    }).sort((a, b) => compareEntries(a.entry, b.entry));
  }, [timetable]);

  const selectedSession = allSessions.find((session) => session.key === sourceKey);

  function clearNotices() {
    setMessage("");
    setError("");
    setValidation(null);
  }

  async function loadPortalData(sessionToken, currentUser, cancelled = false) {
    const endpoint = currentUser ? `${API}/portal/data` : `${API}/portal/public`;
    const response = await fetch(endpoint, { headers: authHeaders(sessionToken) });
    const result = await parseResponse(response);
    if (cancelled) return;

    setCollegeData(result.collegeData || null);
    setTimetable(result.timetable || []);
    setAiRequirements(result.aiRequirements || null);
    setMetadata({ ...INITIAL_METADATA, ...(result.metadata || {}) });

    const nextClass = result.collegeData?.classes?.[0];
    if (nextClass) setSelectedClassId(nextClass.id);
    if (currentUser?.role === "teacher") setSelectedTeacherId(currentUser.teacherId);
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearNotices();
    setBusy(true);
    try {
      const response = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const result = await parseResponse(response);
      sessionStorage.setItem(TOKEN_KEY, result.token);
      setToken(result.token);
      setUser(result.user);
      setPortalMode("authenticated");
      await loadPortalData(result.token, result.user);
      setMessage(`Logged in as ${result.user.displayName} (${result.user.role}).`);
      setLoginForm({ username: "", password: "" });
    } catch (err) {
      setError(err.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function enterPublicView() {
    clearNotices();
    setBusy(true);
    try {
      await loadPortalData("", null);
      setUser(null);
      setPortalMode("public");
      setToken("");
      setMessage("Public timetable view. Select a class to see its schedule.");
    } catch (err) {
      setError(err.message || "Could not load the public timetable.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      if (token) {
        await fetch(`${API}/auth/logout`, {
          method: "POST",
          headers: authHeaders(token),
        });
      }
    } catch {
      // Clear the local session even if the backend is offline.
    }
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setPortalMode("login");
    setCollegeData(null);
    setTimetable([]);
    setAiRequirements(null);
    clearNotices();
  }

  function updateTeacher(teacherId, field, value) {
    setCollegeData((previous) => ({
      ...previous,
      teachers: previous.teachers.map((teacher) =>
        teacher.id === teacherId
          ? { ...teacher, [field]: field === "weeklyWorkload" ? Number(value) : value }
          : teacher
      ),
    }));
  }

  function addTeacher(event) {
    event.preventDefault();
    clearNotices();
    const id = teacherForm.id.trim();
    const name = teacherForm.name.trim();
    const workload = Number(teacherForm.weeklyWorkload);
    if (!id || !name || !Number.isInteger(workload) || workload < 0) {
      setError("Enter a teacher ID, name, and non-negative whole-number weekly workload.");
      return;
    }
    if (teacherOptions.some((teacher) => normalize(teacher.id) === normalize(id))) {
      setError("That teacher ID already exists.");
      return;
    }
    setCollegeData((previous) => ({
      ...previous,
      teachers: [...previous.teachers, { id, name, weeklyWorkload: workload }],
    }));
    setTeacherForm({ id: "", name: "", weeklyWorkload: "16" });
    setMessage(`Teacher ${name} added. Save setup to create the login account.`);
  }

  function removeTeacher(teacherId) {
    const assigned = classOptions.some((cls) => (cls.subjects || []).some((subject) => subject.teacherId === teacherId));
    if (assigned) {
      setError("This teacher is assigned to one or more subjects. Reassign or remove those subjects first.");
      return;
    }
    setCollegeData((previous) => ({
      ...previous,
      teachers: previous.teachers.filter((teacher) => teacher.id !== teacherId),
    }));
    setMessage("Teacher removed from the unsaved setup.");
  }

  function addClass(event) {
    event.preventDefault();
    clearNotices();
    const id = classForm.id.trim();
    const name = classForm.name.trim();
    const semester = Number(classForm.semester);
    if (!id || !name || !Number.isInteger(semester) || semester < 1) {
      setError("Enter a class ID, class/section name, and valid semester.");
      return;
    }
    if (classOptions.some((cls) => normalize(cls.id) === normalize(id) || normalize(cls.name) === normalize(name))) {
      setError("That class ID or class name already exists.");
      return;
    }
    setCollegeData((previous) => ({
      ...previous,
      classes: [...previous.classes, { id, name, semester, subjects: [] }],
    }));
    setSelectedClassId(id);
    setClassForm({ id: "", name: "", semester: "5" });
    setMessage(`Class ${name} added. Add its subjects, then save setup.`);
  }

  function removeClass(classId) {
    setCollegeData((previous) => ({
      ...previous,
      classes: previous.classes.filter((cls) => cls.id !== classId),
    }));
    setMessage("Class removed from the unsaved setup.");
  }

  function addSubject(event) {
    event.preventDefault();
    clearNotices();
    const id = subjectForm.id.trim();
    const name = subjectForm.name.trim();
    const teacherId = subjectForm.teacherId || teacherOptions[0]?.id;
    const periodsPerWeek = Number(subjectForm.periodsPerWeek);
    const type = subjectForm.type;
    const cls = classOptions.find((item) => item.id === selectedClassId);
    if (!cls) {
      setError("Add/select a class before adding subjects.");
      return;
    }
    if (!id || !name || !teacherId || !Number.isInteger(periodsPerWeek) || periodsPerWeek < 1) {
      setError("Enter a subject ID, name, assigned teacher, and positive whole number of periods.");
      return;
    }
    if ((cls.subjects || []).some((item) => normalize(item.id) === normalize(id))) {
      setError("That subject ID already exists in this class.");
      return;
    }
    if (type === "lab" && periodsPerWeek % 2 !== 0) {
      setError("Lab periods must be an even number because labs are scheduled in two-period blocks.");
      return;
    }
    setCollegeData((previous) => ({
      ...previous,
      classes: previous.classes.map((item) => item.id === selectedClassId
        ? { ...item, subjects: [...(item.subjects || []), { id, name, teacherId, periodsPerWeek, type }] }
        : item),
    }));
    setSubjectForm({ id: "", name: "", teacherId: teacherOptions[0]?.id || "", periodsPerWeek: "3", type: "theory" });
    setMessage(`${name} added to ${cls.name}. Save setup before generating.`);
  }

  function removeSubject(classId, subjectId) {
    setCollegeData((previous) => ({
      ...previous,
      classes: previous.classes.map((cls) => cls.id === classId
        ? { ...cls, subjects: cls.subjects.filter((subject) => subject.id !== subjectId) }
        : cls),
    }));
    setMessage("Subject removed from the unsaved setup.");
  }

  function addRoom(event) {
    event.preventDefault();
    const id = roomForm.id.trim();
    if (!id) {
      setError("Enter a room ID or room number.");
      return;
    }
    if (roomOptions.some((room) => normalize(room.id) === normalize(id))) {
      setError("That room already exists.");
      return;
    }
    setCollegeData((previous) => ({
      ...previous,
      rooms: [...previous.rooms, { id, type: roomForm.type }],
    }));
    setRoomForm({ id: "", type: "classroom" });
    setMessage("Room added. Save setup to apply it.");
  }

  function removeRoom(roomId) {
    const inUse = timetable.some((entry) => entry.room === roomId);
    if (inUse) {
      setError("This room is used by the current timetable. Generate a new timetable before removing it.");
      return;
    }
    setCollegeData((previous) => ({
      ...previous,
      rooms: previous.rooms.filter((room) => room.id !== roomId),
    }));
  }

  async function saveSetup(event) {
    event?.preventDefault();
    clearNotices();
    if (!token || !isCreator) {
      setError("Only timetable creators can save the college setup.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API}/portal/data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ collegeData, metadata }),
      });
      const result = await parseResponse(response);
      setCollegeData(result.collegeData);
      setTimetable(result.timetable || []);
      setAiRequirements(result.aiRequirements || null);
      setMessage(result.message || "Setup saved.");
      setSourceKey("");
    } catch (err) {
      setError(err.message || "Could not save the setup.");
    } finally {
      setBusy(false);
    }
  }

  async function generateTimetable(event) {
    event.preventDefault();
    clearNotices();
    if (!prompt.trim()) {
      setError("Enter a timetable prompt.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API}/portal/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ prompt, preferences }),
      });
      const result = await parseResponse(response);
      setTimetable(result.timetable || []);
      setAiRequirements(result.aiRequirements || null);
      setCollegeData(result.collegeData || collegeData);
      setMetadata((previous) => ({ ...previous, ...(result.metadata || {}) }));
      setValidation(result.validation || null);
      setSourceKey("");
      setMessage(result.message || "Timetable generated successfully.");
    } catch (err) {
      setError(err.message || "Timetable generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function modifyTimetable(event) {
    event.preventDefault();
    clearNotices();
    if (!selectedSession) {
      setError("Select a source session to move.");
      return;
    }
    const source = selectedSession.entry;
    const modification = {
      className: source.className || source.classId,
      subjectName: source.subject,
      fromDay: source.day,
      fromPeriod: Number(source.period),
      targetDay,
      targetPeriod: Number(targetPeriod),
      targetTime: "exact",
    };
    setBusy(true);
    try {
      const response = await fetch(`${API}/portal/modify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ modification }),
      });
      const result = await parseResponse(response);
      setTimetable(result.timetable || []);
      setValidation(result.validation || null);
      setMessage(
        `${result.change.subject} moved from ${result.change.fromDay} period ${result.change.fromPeriod} ` +
        `to ${result.change.toDay} period ${result.change.toPeriod}.`
      );
      setSourceKey("");
    } catch (err) {
      setError(err.message || "Could not move the class.");
    } finally {
      setBusy(false);
    }
  }

  function updateMetadata(field, value) {
    setMetadata((previous) => ({ ...previous, [field]: value }));
  }

  function teacherName(id) {
    return collegeData?.teachers?.find((teacher) => teacher.id === id)?.name || id || "—";
  }

  function entryAt(day, period) {
    return viewEntries.find((entry) => normalize(entry.day) === normalize(day) && Number(entry.period) === Number(period));
  }

  function sameLabBlock(entry, next) {
    return Boolean(
      entry && next &&
      normalize(entry.type) === "lab" && normalize(next.type) === "lab" &&
      normalize(entry.classId) === normalize(next.classId) &&
      normalize(entry.subjectId || entry.subject) === normalize(next.subjectId || next.subject) &&
      normalize(entry.room) === normalize(next.room) &&
      Number(next.period) === Number(entry.period) + 1
    );
  }

  function renderRow(day) {
    const cells = [];
    const used = new Set();
    for (const period of PERIODS) {
      if (period === 4) {
        cells.push(<td key={`${day}-break`} className="break-cell"><strong>BREAK</strong><span>{BREAK_LABEL}</span></td>);
      }
      if (used.has(period)) continue;
      const entry = entryAt(day, period);
      const next = entryAt(day, period + 1);
      const canSpan = period !== 3 && period !== 6 && sameLabBlock(entry, next);
      if (canSpan) used.add(period + 1);
      cells.push(
        <td key={`${day}-${period}`} colSpan={canSpan ? 2 : 1} className={`schedule-cell ${entry ? "occupied" : "empty"} ${entry?.type === "lab" ? "lab-cell" : ""}`}>
          {entry ? (
            <div className="slot-content">
              <strong>{entry.subject}</strong>
              <span>{isTeacher ? (entry.className || entry.classId) : teacherName(entry.teacherId)}</span>
              <small>{entry.room || ""}</small>
            </div>
          ) : <span className="empty-slot">—</span>}
        </td>
      );
    }
    return cells;
  }

  const visibleClasses = isTeacher
    ? [...new Set(viewEntries.map((entry) => entry.className || entry.classId))]
    : classOptions.filter((cls) => cls.id === selectedClassId).map((cls) => cls.name);

  const viewSemester = classOptions.find((cls) => cls.id === selectedClassId)?.semester ||
    viewEntries.find((entry) => entry.semester)?.semester || "—";

  function exportPDF() {
    if (!viewEntries.length) {
      setError("There is no timetable to export for this view.");
      return;
    }
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const title = isTeacher ? `${user.displayName} - Teacher Timetable` : viewTitle;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(metadata.collegeName || "COLLEGE NAME", pageWidth / 2, 9, { align: "center" });
      doc.setFontSize(9);
      doc.text(metadata.departmentName || "DEPARTMENT", pageWidth / 2, 15, { align: "center" });
      doc.setFontSize(10);
      doc.text(title, pageWidth / 2, 22, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`W.E.F.: ${dateLabel(metadata.effectiveDate)}    ACADEMIC YEAR: ${metadata.academicYear || "—"}    TERM: ${metadata.term || "—"}`, 8, 28);

      const head = [["DAY", "P1\n9.00-9.55", "P2\n9.55-10.50", "P3\n11.05-12.00", `BREAK\n${BREAK_LABEL}`, "P4\n1.45-2.40", "P5\n2.40-3.35", "P6\n3.35-4.30"]];
      const body = visibleDays.map((day) => [day, ...PERIODS.slice(0, 3).map((p) => cellText(entryAt(day, p), isTeacher ? "teacher" : "class")), "BREAK", ...PERIODS.slice(3).map((p) => cellText(entryAt(day, p), isTeacher ? "teacher" : "class"))]);
      autoTable(doc, {
        startY: 32,
        head,
        body,
        theme: "grid",
        margin: { left: 8, right: 8 },
        styles: { fontSize: 6.5, cellPadding: 1.5, minCellHeight: 12, halign: "center", valign: "middle", overflow: "linebreak" },
        headStyles: { fillColor: [232, 236, 244], textColor: [34, 46, 68], fontStyle: "bold" },
        columnStyles: { 0: { cellWidth: 22, fontStyle: "bold" }, 4: { cellWidth: 17, fillColor: [245, 246, 249] } },
      });
      const courses = new Map();
      for (const entry of viewEntries) {
        const key = `${entry.classId}|${entry.subjectId}`;
        if (!courses.has(key)) {
          courses.set(key, [entry.subjectId || "—", entry.subject, isTeacher ? (entry.className || entry.classId) : teacherName(entry.teacherId), String(entry.type || "theory").toUpperCase(), String(viewEntries.filter((item) => item.classId === entry.classId && item.subjectId === entry.subjectId).length)]);
        }
      }
      const y = (doc.lastAutoTable?.finalY || 100) + 5;
      autoTable(doc, {
        startY: y,
        head: [["COURSE CODE", "COURSE / SUBJECT", isTeacher ? "CLASS / SECTION" : "FACULTY", "TYPE", "SCHEDULED PERIODS"]],
        body: [...courses.values()],
        theme: "grid",
        margin: { left: 8, right: 8 },
        styles: { fontSize: 7, cellPadding: 1.3, overflow: "linebreak" },
        headStyles: { fillColor: [232, 236, 244], textColor: [34, 46, 68], fontStyle: "bold" },
      });
      doc.save(`${sanitizeFilename(title)}_${sanitizeFilename(metadata.academicYear)}.pdf`);
      setMessage("PDF exported successfully.");
      setError("");
    } catch (err) {
      console.error("PDF export error:", err);
      setError("PDF export failed. Check jspdf and jspdf-autotable are installed.");
    }
  }

  function exportExcel() {
    if (!viewEntries.length) {
      setError("There is no timetable to export for this view.");
      return;
    }
    try {
      const tableRows = [
        [metadata.collegeName || "COLLEGE NAME"],
        [metadata.departmentName || "DEPARTMENT"],
        [viewTitle],
        [`W.E.F.: ${dateLabel(metadata.effectiveDate)} | Academic Year: ${metadata.academicYear || "—"} | Term: ${metadata.term || "—"}`],
        [],
        ["DAY", "PERIOD 1", "PERIOD 2", "PERIOD 3", "BREAK", "PERIOD 4", "PERIOD 5", "PERIOD 6"],
        ...visibleDays.map((day) => [day, ...PERIODS.slice(0, 3).map((p) => cellText(entryAt(day, p), isTeacher ? "teacher" : "class")), BREAK_LABEL, ...PERIODS.slice(3).map((p) => cellText(entryAt(day, p), isTeacher ? "teacher" : "class"))]),
        [],
        ["SCHEDULED SESSIONS"],
        ["DAY", "PERIOD", "SUBJECT", "CLASS", "TEACHER", "ROOM", "TYPE"],
        ...[...viewEntries].sort(compareEntries).map((entry) => [entry.day, entry.period, entry.subject, entry.className || entry.classId, teacherName(entry.teacherId), entry.room, entry.type]),
      ];
      const sheet = XLSX.utils.aoa_to_sheet(tableRows);
      sheet["!cols"] = [{ wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 24 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, isTeacher ? "Teacher Timetable" : "Class Timetable");
      XLSX.writeFile(workbook, `${sanitizeFilename(viewTitle)}_${sanitizeFilename(metadata.academicYear)}.xlsx`);
      setMessage("Excel exported successfully.");
      setError("");
    } catch (err) {
      console.error("Excel export error:", err);
      setError("Excel export failed. Check that xlsx is installed.");
    }
  }

  function renderTimetable() {
    if (!viewEntries.length) {
      return <div className="empty-state">No timetable entries are available for this view yet. A timetable creator must save the setup and generate a timetable first.</div>;
    }
    const displayDays = DAYS;
    return (
      <div className="official-timetable">
        <div className="official-heading">
          <div className="college-name">{metadata.collegeName || "COLLEGE NAME"}</div>
          <div className="department-name">{metadata.departmentName || "DEPARTMENT"}</div>
          <div className="timetable-title-row">
            <span>W.E.F.: {dateLabel(metadata.effectiveDate)}</span>
            <strong>{isTeacher ? "TEACHER TIME - TABLE" : "CLASS TIME - TABLE"}</strong>
            <span>ACADEMIC YEAR: {metadata.academicYear || "—"}</span>
          </div>
          <div className="official-meta">
            {isTeacher ? (
              <>
                <span>TEACHER: {user?.displayName}</span>
                <span>TEACHER ID: {currentTeacherId}</span>
                <span>CLASSES: {visibleClasses.join(", ") || "—"}</span>
                <span>TERM: {metadata.term || "—"}</span>
              </>
            ) : (
              <>
                <span>SEMESTER: {viewSemester}</span>
                <span>CLASS: {classOptions.find((cls) => cls.id === selectedClassId)?.name || "—"}</span>
                <span>ROOMS: {[...new Set(viewEntries.map((entry) => entry.room).filter(Boolean))].join(", ") || "—"}</span>
                <span>TERM: {metadata.term || "—"}</span>
              </>
            )}
          </div>
        </div>
        <div className="schedule-table-wrap">
          <table className="schedule-grid">
            <thead><tr>
              <th className="day-heading">DAY</th>
              {PERIODS.slice(0, 3).map((period) => <th key={period}><span className="period-number">PERIOD {period}</span><span className="time-label">{TIMES[period]}</span></th>)}
              <th className="break-heading">BREAK<br />{BREAK_LABEL}</th>
              {PERIODS.slice(3).map((period) => <th key={period}><span className="period-number">PERIOD {period}</span><span className="time-label">{TIMES[period]}</span></th>)}
            </tr></thead>
            <tbody>{displayDays.map((day) => <tr key={day}><th className="row-day">{day.toUpperCase()}</th>{renderRow(day)}</tr>)}</tbody>
          </table>
        </div>
        <div className="course-details">
          <h3>{isTeacher ? "TEACHER'S CLASS / SUBJECT DETAILS" : "COURSE CODE / COURSE NAME / FACULTY"}</h3>
          <div className="schedule-table-wrap">
            <table className="details-table">
              <thead><tr><th>CODE</th><th>SUBJECT</th><th>{isTeacher ? "CLASS / SECTION" : "FACULTY"}</th><th>TYPE</th><th>PERIODS / WEEK (IN VIEW)</th></tr></thead>
              <tbody>
                {[...new Map(viewEntries.map((entry) => [`${entry.classId}|${entry.subjectId}`, entry])).values()]
                  .sort((a, b) => String(a.className).localeCompare(String(b.className)) || String(a.subject).localeCompare(String(b.subject)))
                  .map((entry) => (
                    <tr key={`${entry.classId}-${entry.subjectId}`}>
                      <td>{entry.subjectId || "—"}</td>
                      <td>{entry.subject}</td>
                      <td>{isTeacher ? (entry.className || entry.classId) : teacherName(entry.teacherId)}</td>
                      <td>{entry.type || "theory"}</td>
                      <td>{viewEntries.filter((item) => item.classId === entry.classId && item.subjectId === entry.subjectId).length}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (portalMode === "login") {
    return (
      <main className="login-shell">
        <div className="login-card">
          <p className="eyebrow">SMART CAMPUS · TIMETABLE PORTAL</p>
          <h1>College timetable</h1>
          <p className="subtitle">Sign in as a timetable creator or teacher, or continue to the public timetable viewer.</p>
          <form onSubmit={handleLogin} className="login-form">
            <label>Username<input autoComplete="username" value={loginForm.username} onChange={(event) => setLoginForm((p) => ({ ...p, username: event.target.value }))} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={loginForm.password} onChange={(event) => setLoginForm((p) => ({ ...p, password: event.target.value }))} required /></label>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "Signing in..." : "Login"}</button>
          </form>
          <button type="button" className="secondary-button full-width" onClick={enterPublicView} disabled={busy}>Continue as public viewer</button>
          {error && <div className="notice failure" role="alert"><strong>Unable to login</strong><span>{error}</span></div>}
          <div className="demo-credentials">
            <strong>Local demo accounts</strong>
            <span>Creator: creator1 · Password: Creator@123</span>
            <span>Teachers: use your teacher ID · Password: Teacher@123</span>
            <small>Change these demo credentials before any real deployment.</small>
          </div>
        </div>
      </main>
    );
  }

  if (!collegeData) {
    return <main className="app-shell"><section className="panel"><p>Loading timetable portal…</p>{error && <p className="error-text">{error}</p>}<button className="secondary-button" onClick={logout}>Back to login</button></section></main>;
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">SMART CAMPUS · TIMETABLE PORTAL</p>
          <h1>{isCreator ? "Timetable Creator Dashboard" : isTeacher ? "Teacher Timetable" : "Public Timetable"}</h1>
          <p className="subtitle">{isCreator ? "Manage faculty, classes, subjects, workload and schedule generation." : isTeacher ? "Your schedule includes every class and subject assigned to you." : "Choose a class or section to view its official weekly timetable."}</p>
        </div>
        <div className="header-actions">
          <span className="class-badge">{user ? `${user.displayName} · ${user.role}` : "Public viewer"}</span>
          <button type="button" className="secondary-button" onClick={user ? logout : () => setPortalMode("login")}>{user ? "Logout" : "Creator / Teacher Login"}</button>
        </div>
      </header>

      {isCreator && (
        <>
          <section className="panel">
            <div className="section-heading"><div><h2>Institution details</h2><p>These appear on screen and in the exported timetable files.</p></div></div>
            <div className="metadata-grid">
              <label>Institution<input value={metadata.collegeName || ""} onChange={(e) => updateMetadata("collegeName", e.target.value)} /></label>
              <label>Department<input value={metadata.departmentName || ""} onChange={(e) => updateMetadata("departmentName", e.target.value)} /></label>
              <label>W.E.F. date<input type="date" value={metadata.effectiveDate || ""} onChange={(e) => updateMetadata("effectiveDate", e.target.value)} /></label>
              <label>Academic year<input value={metadata.academicYear || ""} onChange={(e) => updateMetadata("academicYear", e.target.value)} /></label>
              <label>Term / date range<input value={metadata.term || ""} onChange={(e) => updateMetadata("term", e.target.value)} placeholder="e.g. 01.08.2026 to 30.11.2026" /></label>
              <label>Periods per day<input type="number" min="1" max="12" value={collegeData.periodsPerDay} onChange={(e) => setCollegeData((p) => ({ ...p, periodsPerDay: Number(e.target.value) }))} /></label>
              <label>Lunch after period<input type="number" min="1" max={Math.max(1, collegeData.periodsPerDay - 1)} value={collegeData.lunchAfterPeriod ?? 3} onChange={(e) => setCollegeData((p) => ({ ...p, lunchAfterPeriod: Number(e.target.value) }))} /></label>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading"><div><h2>1. Teachers and weekly workload</h2><p>Add the faculty members first. Each teacher account uses their teacher ID as username.</p></div></div>
            <div className="table-wrapper"><table className="data-table"><thead><tr><th>Teacher ID / username</th><th>Teacher name</th><th>Maximum periods / week</th><th>Teacher login</th><th>Action</th></tr></thead><tbody>
              {teacherOptions.map((teacher) => <tr key={teacher.id}><td>{teacher.id}</td><td><input value={teacher.name} onChange={(e) => updateTeacher(teacher.id, "name", e.target.value)} /></td><td><input type="number" min="0" max="100" value={teacher.weeklyWorkload} onChange={(e) => updateTeacher(teacher.id, "weeklyWorkload", e.target.value)} /></td><td><code>{teacher.id}</code><small className="muted-line">Default password: Teacher@123</small></td><td><button type="button" className="small-danger" onClick={() => removeTeacher(teacher.id)}>Remove</button></td></tr>)}
            </tbody></table></div>
            <form className="inline-add-form" onSubmit={addTeacher}>
              <label>Teacher ID<input placeholder="e.g. T5" value={teacherForm.id} onChange={(e) => setTeacherForm((p) => ({ ...p, id: e.target.value }))} required /></label>
              <label>Teacher name<input placeholder="e.g. Priya" value={teacherForm.name} onChange={(e) => setTeacherForm((p) => ({ ...p, name: e.target.value }))} required /></label>
              <label>Max periods/week<input type="number" min="0" value={teacherForm.weeklyWorkload} onChange={(e) => setTeacherForm((p) => ({ ...p, weeklyWorkload: e.target.value }))} required /></label>
              <button className="secondary-button" type="submit">Add teacher</button>
            </form>
          </section>

          <section className="panel">
            <div className="section-heading"><div><h2>2. Classes, sections and subjects</h2><p>Subjects are assigned to a teacher for each class. The same teacher can teach multiple classes.</p></div></div>
            <form className="inline-add-form" onSubmit={addClass}>
              <label>Class ID<input placeholder="e.g. CSE-C" value={classForm.id} onChange={(e) => setClassForm((p) => ({ ...p, id: e.target.value }))} required /></label>
              <label>Class / section name<input placeholder="e.g. CSE-C" value={classForm.name} onChange={(e) => setClassForm((p) => ({ ...p, name: e.target.value }))} required /></label>
              <label>Semester<input type="number" min="1" max="12" value={classForm.semester} onChange={(e) => setClassForm((p) => ({ ...p, semester: e.target.value }))} required /></label>
              <button type="submit" className="secondary-button">Add class</button>
            </form>
            <div className="class-subject-toolbar"><label>Manage subjects for<select value={selectedClassId} onChange={(e) => { setSelectedClassId(e.target.value); setSourceKey(""); }}><option value="">Select class</option>{classOptions.map((cls) => <option key={cls.id} value={cls.id}>{cls.name} · Semester {cls.semester}</option>)}</select></label></div>
            {classOptions.map((cls) => <div className="class-admin-block" key={cls.id}>
              <div className="class-admin-title"><strong>{cls.name} · Semester {cls.semester}</strong><button className="small-danger" type="button" onClick={() => removeClass(cls.id)}>Remove class</button></div>
              <div className="table-wrapper"><table className="data-table"><thead><tr><th>Subject ID</th><th>Subject name</th><th>Teacher</th><th>Periods/week</th><th>Type</th><th>Action</th></tr></thead><tbody>
                {(cls.subjects || []).map((subject) => <tr key={`${cls.id}-${subject.id}`}><td>{subject.id}</td><td>{subject.name}</td><td>{teacherName(subject.teacherId)} ({subject.teacherId})</td><td>{subject.periodsPerWeek}</td><td>{subject.type}</td><td><button className="small-danger" type="button" onClick={() => removeSubject(cls.id, subject.id)}>Remove</button></td></tr>)}
                {(!cls.subjects || cls.subjects.length === 0) && <tr><td colSpan="6" className="empty-row">No subjects have been added to this class.</td></tr>}
              </tbody></table></div>
            </div>)}
            <form className="inline-add-form" onSubmit={addSubject}>
              <label>Subject ID<input placeholder="e.g. SUB010" value={subjectForm.id} onChange={(e) => setSubjectForm((p) => ({ ...p, id: e.target.value }))} required /></label>
              <label>Subject name<input placeholder="e.g. Computer Graphics" value={subjectForm.name} onChange={(e) => setSubjectForm((p) => ({ ...p, name: e.target.value }))} required /></label>
              <label>Assigned teacher<select value={subjectForm.teacherId || teacherOptions[0]?.id || ""} onChange={(e) => setSubjectForm((p) => ({ ...p, teacherId: e.target.value }))} required>{teacherOptions.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name} ({teacher.id})</option>)}</select></label>
              <label>Periods / week<input type="number" min="1" value={subjectForm.periodsPerWeek} onChange={(e) => setSubjectForm((p) => ({ ...p, periodsPerWeek: e.target.value }))} required /></label>
              <label>Type<select value={subjectForm.type} onChange={(e) => setSubjectForm((p) => ({ ...p, type: e.target.value }))}><option value="theory">Theory</option><option value="lab">Lab (2-period blocks)</option></select></label>
              <button type="submit" className="secondary-button">Add subject to selected class</button>
            </form>
          </section>

          <section className="panel">
            <div className="section-heading"><div><h2>3. Rooms</h2><p>Rooms can be classrooms or labs. The solver uses room type to prevent incompatible assignments.</p></div></div>
            <div className="room-list">{roomOptions.map((room) => <div className="room-chip" key={room.id}><span><strong>{room.id}</strong> · {room.type}</span><button type="button" className="small-danger" onClick={() => removeRoom(room.id)}>Remove</button></div>)}</div>
            <form className="inline-add-form" onSubmit={addRoom}>
              <label>Room number / ID<input placeholder="e.g. LAB3" value={roomForm.id} onChange={(e) => setRoomForm((p) => ({ ...p, id: e.target.value }))} required /></label>
              <label>Room type<select value={roomForm.type} onChange={(e) => setRoomForm((p) => ({ ...p, type: e.target.value }))}><option value="classroom">Classroom</option><option value="lab">Lab</option></select></label>
              <button type="submit" className="secondary-button">Add room</button>
            </form>
          </section>

          <section className="panel">
            <div className="section-heading"><div><h2>4. Generate timetable</h2><p>Save setup before generating. Teacher demand cannot exceed the teacher's weekly limit.</p></div><span className="local-badge">OR-Tools + optional Gemini</span></div>
            <form className="generation-form" onSubmit={generateTimetable}>
              <label className="prompt-field">Scheduling prompt<textarea rows="4" value={prompt} onChange={(e) => setPrompt(e.target.value)} required placeholder="Describe scheduling preferences, e.g. labs after lunch and avoid subject repeats." /></label>
              <div className="preference-grid">
                <label className="checkbox-line"><input type="checkbox" checked={preferences.labsAfterLunch} onChange={(e) => setPreferences((p) => ({ ...p, labsAfterLunch: e.target.checked }))} /> Schedule labs after lunch</label>
                <label className="checkbox-line"><input type="checkbox" checked={preferences.avoidRepeatedSubjectSameDay} onChange={(e) => setPreferences((p) => ({ ...p, avoidRepeatedSubjectSameDay: e.target.checked }))} /> Avoid repeating a subject on the same day</label>
              </div>
              <div className="button-row"><button type="button" className="secondary-button" onClick={saveSetup} disabled={busy}>Save teachers / classes / subjects</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Working…" : "Generate timetable"}</button></div>
              <p className="helper-text">If Gemini quota is unavailable, the backend falls back to the structured teacher/subject setup and the preference checkboxes. The free-text prompt fallback recognises common lab-after-lunch and repetition instructions.</p>
            </form>
          </section>

          {timetable.length > 0 && (
            <section className="panel">
              <div className="section-heading"><div><h2>5. Move a scheduled class</h2><p>Moves are checked for class, teacher, room, and subject-repeat conflicts.</p></div><span className="local-badge">No Gemini required</span></div>
              <form className="modify-form" onSubmit={modifyTimetable}>
                <label>Existing session<select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)} required><option value="">Select a session</option>{allSessions.map((session) => <option key={session.key} value={session.key}>{session.label}</option>)}</select></label>
                <label>New day<select value={targetDay} onChange={(e) => setTargetDay(e.target.value)}>{DAYS.map((day) => <option key={day}>{day}</option>)}</select></label>
                <label>New period<select value={targetPeriod} onChange={(e) => setTargetPeriod(e.target.value)}>{PERIODS.map((period) => <option key={period} value={period}>Period {period}</option>)}</select></label>
                <button type="submit" className="primary-button" disabled={busy || !selectedSession}>{busy ? "Updating…" : "Move class"}</button>
              </form>
            </section>
          )}
        </>
      )}

      {!isCreator && (
        <section className="panel">
          <div className="section-heading"><div><h2>{isTeacher ? "My teaching schedule" : "Find a class timetable"}</h2><p>{isTeacher ? "This view includes every class and subject assigned to your teacher ID." : "Select one class/section. Public view never combines all class timetables into one class schedule."}</p></div></div>
          {isPublic && <div className="public-picker"><label>Class / section<select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>{classOptions.map((cls) => <option key={cls.id} value={cls.id}>{cls.name} · Semester {cls.semester}</option>)}</select></label></div>}
          {isTeacher && <div className="teacher-summary"><div><span>Teacher</span><strong>{user.displayName}</strong></div><div><span>Teacher ID</span><strong>{currentTeacherId}</strong></div><div><span>Classes taught</span><strong>{visibleClasses.length}</strong></div><div><span>Scheduled entries</span><strong>{viewEntries.length}</strong></div></div>}
        </section>
      )}

      <section className="panel timetable-panel">
        <div className="section-heading export-heading">
          <div><h2>{viewTitle}</h2><p>{isTeacher ? `${viewEntries.length} teaching-period entries across all assigned classes` : `${viewEntries.length} scheduled-period entries`}</p></div>
          <div className="export-actions">
            {!isTeacher && classOptions.length > 0 && <label className="class-picker">View class<select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>{classOptions.map((cls) => <option key={cls.id} value={cls.id}>{cls.name}</option>)}</select></label>}
            <button type="button" className="secondary-button" onClick={exportPDF} disabled={!viewEntries.length}>Export PDF</button>
            <button type="button" className="secondary-button" onClick={exportExcel} disabled={!viewEntries.length}>Export Excel</button>
            <button type="button" className="secondary-button" onClick={() => window.print()}>Print</button>
          </div>
        </div>
        {renderTimetable()}
      </section>

      {message && <div className="notice success" role="status"><strong>Success</strong><span>{message}</span>{validation && <span>Validation: {validation.valid ? "Passed" : "Failed"}{validation.errors?.length ? ` — ${validation.errors.join("; ")}` : ""}</span>}</div>}
      {error && <div className="notice failure" role="alert"><strong>Unable to complete request</strong><span>{error}</span></div>}
      <footer className="page-footer">Creators manage shared college data · Teachers see their own sessions across all classes · Public users select a class · Export to PDF or Excel.</footer>
    </main>
  );
}
