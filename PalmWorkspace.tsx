import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { palmExecutionFeedback } from "@/lib/runnerEvents";
import { consumePalmExecutionStream } from "@/lib/executionStream";
import { resolveRunnerScopePreservation } from "@/lib/runnerScope";
import { AUDIT_EXPORT_COLUMNS, serializeAuditCsv, type AuditExportColumn } from "@/lib/auditCsv";
import { approvalRemainingMs, formatApprovalCountdown, isApprovalNearExpiry } from "@/lib/approvalCountdown";
import { restoreAuditPresetFilters } from "@/lib/auditPreset";
import { applyDeviceAuditExportTemplate } from "@/lib/auditExportTemplate";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import {
  Archive,
  ArrowUp,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Code2,
  Command,
  Download,
  FileSearch,
  FileText,
  FolderPlus,
  Globe2,
  LayoutDashboard,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";

type View = "workspace" | "skills" | "dashboard" | "settings";
type PendingFile = { file: File; id: string };

const suggestedObjectives = [
  "Map the key risks and opportunities for a new market launch",
  "Turn this brief into a clear execution plan with owners and milestones",
  "Analyze the uploaded material and recommend the next best action",
];

const navItems: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "workspace", label: "Workspace", icon: Command },
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "skills", label: "Capabilities", icon: Sparkles },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",")[1] || "");
    };
    reader.readAsDataURL(file);
  });
}

function formatTime(date: Date | string | number) {
  const parsed = new Date(date);
  const minutes = Math.max(1, Math.round((Date.now() - parsed.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StatusChip({ status }: { status: "queued" | "running" | "completed" | "error" }) {
  const labels = {
    queued: "Queued",
    running: "Working",
    completed: "Complete",
    error: "Needs review",
  } as const;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.13em]",
      status === "running" && "bg-violet-400/12 text-violet-200",
      status === "completed" && "bg-emerald-400/10 text-emerald-300",
      status === "queued" && "bg-white/[0.06] text-slate-400",
      status === "error" && "bg-rose-400/10 text-rose-300",
    )}>
      <span className={cn("size-1.5 rounded-full", status === "running" && "animate-pulse bg-violet-300", status === "completed" && "bg-emerald-300", status === "queued" && "bg-slate-500", status === "error" && "bg-rose-300")} />
      {labels[status]}
    </span>
  );
}

function LogoMark() {
  return (
    <div className="relative grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-300 via-indigo-400 to-cyan-300 shadow-[0_0_32px_rgba(139,92,246,0.34)]">
      <span className="font-serif text-lg font-bold leading-none text-slate-950">P</span>
      <span className="absolute inset-0 rounded-xl border border-white/30" />
    </div>
  );
}

function ToolGlyph({ kind }: { kind: "plan" | "tool" | "decision" | "result" }) {
  const Icon = kind === "plan" ? Workflow : kind === "tool" ? Zap : kind === "decision" ? Sparkles : Check;
  return <Icon className="size-3.5" strokeWidth={2.1} />;
}

export default function PalmWorkspace() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const utils = trpc.useUtils();
  const [view, setView] = useState<View>("workspace");
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [composer, setComposer] = useState("");
  const [localRunnerToken, setLocalRunnerToken] = useState<string | null>(null);
  const [waitingForLocalRunner, setWaitingForLocalRunner] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [attachmentRoute, setAttachmentRoute] = useState<"local" | "cloud">("local");
  const [executionTarget, setExecutionTarget] = useState<"auto" | "local_browser">("auto");
  const [isExecuting, setIsExecuting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tasksQuery = trpc.palm.tasks.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: isExecuting ? 1500 : false });
  const projectsQuery = trpc.palm.projects.useQuery(undefined, { enabled: isAuthenticated });
  const skillsQuery = trpc.palm.skills.useQuery(undefined, { enabled: isAuthenticated });
  const dashboardQuery = trpc.palm.dashboard.useQuery(undefined, { enabled: isAuthenticated });
  const localRunnersQuery = trpc.palm.localRunners.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 10_000 });
  const localRunnerDashboardQuery = trpc.palm.localRunnerDashboard.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 10_000 });
  const taskQuery = trpc.palm.task.useQuery({ taskId: activeTaskId ?? 1 }, {
    enabled: isAuthenticated && activeTaskId !== null,
    refetchInterval: isExecuting ? 1000 : false,
  });

  const createTask = trpc.palm.createTask.useMutation();
  const uploadAttachment = trpc.palm.uploadAttachment.useMutation();
  const referenceLocalAttachment = trpc.palm.referenceLocalAttachment.useMutation();
  const resumeTask = trpc.palm.resumeTask.useMutation();
  const deleteTask = trpc.palm.deleteTask.useMutation();
  const cancelTask = trpc.palm.cancelTask.useMutation();
  const registerLocalRunner = trpc.palm.registerLocalRunner.useMutation();
  const renameLocalRunner = trpc.palm.renameLocalRunner.useMutation();
  const revokeLocalRunner = trpc.palm.revokeLocalRunner.useMutation();
  const updateLocalRunnerScope = trpc.palm.updateLocalRunnerScope.useMutation();
  const setLocalApprovalExpiry = trpc.palm.setLocalApprovalExpiry.useMutation();
  const setLocalRunnerApprovalExpiryOverride = trpc.palm.setLocalRunnerApprovalExpiryOverride.useMutation();
  const decideLocalApproval = trpc.palm.decideLocalApproval.useMutation();
  const setSkill = trpc.palm.setSkill.useMutation();
  const createProject = trpc.palm.createProject.useMutation();

  useEffect(() => {
    if (!activeTaskId && tasksQuery.data?.[0]) setActiveTaskId(tasksQuery.data[0].id);
  }, [activeTaskId, tasksQuery.data]);

  const displayedSteps = useMemo(() => taskQuery.data?.steps ?? [], [taskQuery.data?.steps]);

  const currentTask = taskQuery.data?.task;
  const attachedFiles = taskQuery.data?.attachments ?? [];
  const messages = taskQuery.data?.messages ?? [];
  const latestRun = taskQuery.data?.latestRun ?? null;
  const runnerEvents = taskQuery.data?.runnerEvents ?? [];
  const localApproval = taskQuery.data?.localApproval ?? null;
  const runnerIsActive = Boolean(latestRun && !["completed", "failed", "cancelled"].includes(latestRun.status));
  const localFileRunnerOnline = Boolean(localRunnersQuery.data?.some(runner => runner.runnerType === "file" && runner.status === "online" && runner.lastSeenAt && Date.now() - new Date(runner.lastSeenAt).getTime() < 90_000));
  const localBrowserRunnerOnline = Boolean(localRunnersQuery.data?.some(runner => runner.runnerType === "browser" && runner.status === "online" && runner.lastSeenAt && Date.now() - new Date(runner.lastSeenAt).getTime() < 90_000));

  useEffect(() => {
    if (!runnerIsActive || !activeTaskId) return;
    const refresh = window.setInterval(() => { void invalidateWorkspace(activeTaskId); }, 1500);
    return () => window.clearInterval(refresh);
  }, [runnerIsActive, activeTaskId]);

  useEffect(() => {
    if (!waitingForLocalRunner || !activeTaskId) return;
    if (currentTask?.status !== "queued") {
      setWaitingForLocalRunner(false);
      return;
    }
    const refresh = window.setInterval(() => { void invalidateWorkspace(activeTaskId); }, 1500);
    return () => window.clearInterval(refresh);
  }, [waitingForLocalRunner, activeTaskId, currentTask?.status]);

  const invalidateWorkspace = async (taskId?: number) => {
    await Promise.all([
      utils.palm.tasks.invalidate(),
      utils.palm.dashboard.invalidate(),
      ...(taskId ? [utils.palm.task.invalidate({ taskId })] : []),
    ]);
  };

  const executeTaskStream = async (taskId: number) => {
    const outcome = await consumePalmExecutionStream({ taskId, onEvent: () => invalidateWorkspace(taskId) });
    await invalidateWorkspace(taskId);
    return outcome;
  };

  const submitTask = async () => {
    const prompt = composer.trim();
    if (!prompt || isExecuting) return;
    if (!isAuthenticated) {
      toast.message("Sign in to delegate work to Palm.ai.");
      startLogin();
      return;
    }
    const oversized = pendingFiles.find(({ file }) => file.size > 5 * 1024 * 1024);
    if (oversized) {
      toast.error(`${oversized.file.name} exceeds the 5 MB attachment limit.`);
      return;
    }

    setIsExecuting(true);
    try {
      const useLocalReferences = pendingFiles.length > 0 && attachmentRoute === "local" && localFileRunnerOnline;
      if (attachmentRoute === "local" && pendingFiles.length > 0 && !localFileRunnerOnline) {
        toast.error("Connect a file Local Runner before using local-only attachments. Palm will not silently upload them.");
        return;
      }
      if (executionTarget === "local_browser" && !localBrowserRunnerOnline) {
        toast.error("Connect a Local Browser Runner before delegating a browser task.");
        return;
      }
      const created = await createTask.mutateAsync({ prompt, executionTarget: executionTarget === "local_browser" ? "local_browser" : useLocalReferences ? "local_file" : "auto" });
      setActiveTaskId(created.taskId);
      setComposer("");
      setView("workspace");

      for (const item of pendingFiles) {
        if (useLocalReferences) {
          await referenceLocalAttachment.mutateAsync({ taskId: created.taskId, name: item.file.name, mimeType: item.file.type || "application/octet-stream", fileSize: item.file.size, localRelativePath: item.file.name });
        } else {
          const data = await fileToBase64(item.file);
          await uploadAttachment.mutateAsync({ taskId: created.taskId, name: item.file.name, mimeType: item.file.type || "application/octet-stream", data });
        }
      }
      setPendingFiles([]);
      await invalidateWorkspace(created.taskId);
      const result = await executeTaskStream(created.taskId);
      setWaitingForLocalRunner(result.localQueued);
      const feedback = palmExecutionFeedback(result);
      toast.success(feedback === "queued" ? "Palm queued the task for your Local Runner. It will begin when your machine claims it." : feedback === "dispatched" ? "Palm dispatched an isolated runner. Live evidence will appear as it works." : "Palm completed the action.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Palm could not complete that action.");
    } finally {
      setIsExecuting(false);
    }
  };

  const handleResume = async (taskId: number) => {
    if (!isAuthenticated) return;
    try {
      const result = await resumeTask.mutateAsync({ taskId });
      await invalidateWorkspace(result.taskId);
      setActiveTaskId(result.taskId);
      setView("workspace");
      toast.success("A new action has been prepared from this workflow.");
    } catch {
      toast.error("Palm could not resume this task.");
    }
  };

  const handleDelete = async (taskId: number) => {
    if (!isAuthenticated) return;
    try {
      await deleteTask.mutateAsync({ taskId });
      if (taskId === activeTaskId) setActiveTaskId(null);
      await invalidateWorkspace();
      toast.success("Task removed from your workspace.");
    } catch {
      toast.error("Palm could not remove this task.");
    }
  };

  const handleCancel = async () => {
    if (!currentTask || !latestRun || cancelTask.isPending) return;
    try {
      const result = await cancelTask.mutateAsync({ taskId: currentTask.id });
      await invalidateWorkspace(currentTask.id);
      toast.message(result.status === "cancellation_requested" ? "Palm requested the runner to stop." : "This runner has already reached a terminal state.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Palm could not request runner cancellation.");
    }
  };

  const handleRegisterLocalRunner = async (runnerType: "file" | "browser" = "file") => {
    try {
      const registered = await registerLocalRunner.mutateAsync({ label: runnerType === "browser" ? "My local browser runner" : "My local runner", runnerType });
      setLocalRunnerToken(registered.token);
      await localRunnersQuery.refetch();
      await localRunnerDashboardQuery.refetch();
      toast.success(`${runnerType === "browser" ? "Local Browser Runner" : "Local Runner"} token created. Copy it now; Palm will not display it again after this session.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Palm could not register the local runner.");
    }
  };

  const handleRenameLocalRunner = async (runnerId: number, currentLabel: string) => {
    const label = window.prompt("Name this Local Runner", currentLabel);
    if (!label?.trim()) return;
    try {
      await renameLocalRunner.mutateAsync({ runnerId, label: label.trim() });
      await localRunnersQuery.refetch();
      await localRunnerDashboardQuery.refetch();
      toast.success("Local Runner renamed.");
    } catch { toast.error("Palm could not rename this Local Runner."); }
  };

  const handleRevokeLocalRunner = async (runnerId: number) => {
    if (!window.confirm("Revoke this Local Runner? Its current token will stop working immediately.")) return;
    try {
      await revokeLocalRunner.mutateAsync({ runnerId });
      await localRunnersQuery.refetch();
      await localRunnerDashboardQuery.refetch();
      toast.success("Local Runner revoked.");
    } catch { toast.error("Palm could not revoke this Local Runner."); }
  };

  const handleLocalApproval = async (decision: "approved" | "rejected") => {
    if (!currentTask) return;
    try {
      await decideLocalApproval.mutateAsync({ taskId: currentTask.id, decision });
      await invalidateWorkspace(currentTask.id);
      toast.success(decision === "approved" ? "Sensitive local action approved. Your Local Runner may claim it now." : "Sensitive local action rejected. Palm will not release it to the Local Runner.");
    } catch { toast.error("Palm could not record this approval decision."); }
  };

  const handleRunnerScope = async (runnerId: number, allowedTools: string[], requiresApprovalForSensitive: boolean, allowedSkillSlugs?: string[], allowedSensitiveActions?: string[], allowedBrowserTools?: string[], navigationAllowlist?: string[], requiresApprovalForBrowserWrites?: boolean) => {
    try {
      const runner = localRunnerDashboardQuery.data?.runners.find(item => item.id === runnerId);
      const preserved = resolveRunnerScopePreservation(runner, { allowedSkillSlugs, allowedSensitiveActions, allowedBrowserTools, navigationAllowlist, requiresApprovalForBrowserWrites });
      await updateLocalRunnerScope.mutateAsync({ runnerId, allowedTools: allowedTools as any, allowedSkillSlugs: preserved.allowedSkillSlugs, allowedSensitiveActions: preserved.allowedSensitiveActions as any, allowedBrowserTools: preserved.allowedBrowserTools as any, navigationAllowlist: preserved.navigationAllowlist, requiresApprovalForSensitive, requiresApprovalForBrowserWrites: preserved.requiresApprovalForBrowserWrites });
      await localRunnerDashboardQuery.refetch();
      toast.success("Device execution scope updated.");
    } catch { toast.error("Palm could not update this device scope."); }
  };

  const handleApprovalExpiry = async (expiryMinutes: number) => {
    try {
      await setLocalApprovalExpiry.mutateAsync({ expiryMinutes });
      await localRunnerDashboardQuery.refetch();
      toast.success("Approval timeout updated.");
    } catch { toast.error("Palm could not update the approval timeout."); }
  };

  const handleRunnerApprovalExpiryOverride = async (runnerId: number, expiryMinutes: number | null) => {
    try {
      await setLocalRunnerApprovalExpiryOverride.mutateAsync({ runnerId, expiryMinutes });
      await localRunnerDashboardQuery.refetch();
      toast.success(expiryMinutes === null ? "Device now uses the workspace approval timeout." : "Device-specific approval timeout updated.");
    } catch { toast.error("Palm could not update this device’s approval timeout."); }
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const accepted = Array.from(files).filter(file => file.size <= 5 * 1024 * 1024);
    if (accepted.length < files.length) toast.message("Files larger than 5 MB were skipped.");
    setPendingFiles(current => [...current, ...accepted.map(file => ({ file, id: `${file.name}-${file.lastModified}-${Math.random()}` }))]);
  };

  const downloadResult = () => {
    if (!currentTask?.assistantResponse) return;
    const markdown = `# ${currentTask.title}\n\n## Delegated objective\n\n${currentTask.prompt}\n\n## Palm.ai deliverable\n\n${currentTask.assistantResponse}\n`;
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${currentTask.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "palm-result"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const newProject = async () => {
    if (!isAuthenticated) return startLogin();
    const title = window.prompt("Name your new project");
    if (!title?.trim()) return;
    try {
      await createProject.mutateAsync({ title: title.trim() });
      await projectsQuery.refetch();
      toast.success("Project created.");
    } catch {
      toast.error("Palm could not create this project.");
    }
  };

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-[#0a0d16]"><Loader2 className="size-5 animate-spin text-violet-300" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#090b13] text-slate-100 selection:bg-violet-400/30">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="palm-glow absolute -left-52 -top-56 size-[38rem] rounded-full bg-violet-500/10 blur-[130px]" />
        <div className="absolute -right-72 top-1/3 size-[30rem] rounded-full bg-cyan-400/[0.045] blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
      </div>

      <main className="relative grid min-h-screen xl:grid-cols-[270px_minmax(0,1fr)_360px]">
        <aside className="hidden min-h-screen flex-col border-r border-white/[0.075] bg-[#0d101a]/90 xl:flex">
          <div className="flex h-[78px] items-center justify-between px-5">
            <button className="flex items-center gap-3 text-left" onClick={() => setView("workspace")}>
              <LogoMark />
              <span className="font-serif text-[21px] font-semibold tracking-[-0.05em] text-white">Palm<span className="text-violet-300">.ai</span></span>
            </button>
            <button className="grid size-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-white/[0.055] hover:text-slate-200" aria-label="Search workspace">
              <Search className="size-4" />
            </button>
          </div>

          <div className="px-3">
            <Button onClick={() => { setActiveTaskId(null); setComposer(""); setView("workspace"); }} className="h-10 w-full justify-start gap-2.5 rounded-xl border border-violet-300/20 bg-violet-400/12 px-3.5 text-[13px] font-semibold text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-violet-400/18">
              <Plus className="size-4" /> New action
            </Button>
          </div>

          <nav className="mt-6 px-3">
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">Control room</p>
            <div className="space-y-1">
              {navItems.map(item => {
                const Icon = item.icon;
                const isActive = view === item.id;
                return <button key={item.id} onClick={() => setView(item.id)} className={cn("group flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] transition-all", isActive ? "bg-white/[0.075] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" : "text-slate-400 hover:bg-white/[0.045] hover:text-slate-200")}>
                  <Icon className={cn("size-4", isActive ? "text-violet-300" : "text-slate-500 group-hover:text-slate-300")} />
                  <span>{item.label}</span>
                  {item.id === "skills" && <span className="ml-auto rounded-md bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-bold text-violet-300">{skillsQuery.data?.filter(skill => skill.enabled).length ?? "–"}</span>}
                </button>;
              })}
            </div>
          </nav>

          <div className="mt-7 min-h-0 flex-1 px-3">
            <div className="flex items-center justify-between px-3 pb-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">Recent actions</p>
              <Archive className="size-3.5 text-slate-600" />
            </div>
            <ScrollArea className="h-[calc(100vh-432px)]">
              <div className="space-y-1 pr-1">
                {!isAuthenticated ? (
                  <div className="rounded-xl border border-dashed border-white/[0.08] px-3 py-4 text-[11px] leading-relaxed text-slate-600">Your saved workflows will appear here after you sign in.</div>
                ) : tasksQuery.isLoading ? (
                  <div className="space-y-2 px-2 pt-2"><div className="h-10 animate-pulse rounded-lg bg-white/[0.045]" /><div className="h-10 animate-pulse rounded-lg bg-white/[0.035]" /></div>
                ) : tasksQuery.data?.length ? tasksQuery.data.map(task => (
                  <div key={task.id} className={cn("group flex items-center gap-2 rounded-xl p-1 transition-colors", activeTaskId === task.id && view === "workspace" ? "bg-white/[0.065]" : "hover:bg-white/[0.035]")}>
                    <button onClick={() => { setActiveTaskId(task.id); setView("workspace"); }} className="min-w-0 flex-1 px-2 py-2 text-left">
                      <div className="flex items-center gap-2"><span className={cn("size-1.5 shrink-0 rounded-full", task.status === "completed" ? "bg-emerald-300" : task.status === "error" ? "bg-rose-300" : "bg-violet-300")} /><p className="truncate text-[12px] font-medium text-slate-300">{task.title}</p></div>
                      <p className="mt-1 pl-3.5 text-[10px] text-slate-600">{formatTime(task.updatedAt)}</p>
                    </button>
                    <button onClick={() => handleDelete(task.id)} className="mr-1 grid size-7 place-items-center rounded-lg text-slate-700 opacity-0 transition-all hover:bg-rose-400/10 hover:text-rose-300 group-hover:opacity-100" aria-label={`Delete ${task.title}`}><Trash2 className="size-3.5" /></button>
                  </div>
                )) : <div className="px-3 py-3 text-[11px] leading-relaxed text-slate-600">No actions yet. Delegate your first objective from the workspace.</div>}
              </div>
            </ScrollArea>
          </div>

          <div className="border-t border-white/[0.075] p-3">
            {isAuthenticated ? <div className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04]">
              <Avatar className="size-8 border border-white/10"><AvatarFallback className="bg-gradient-to-br from-violet-300 to-cyan-200 text-[11px] font-bold text-slate-950">{user?.name?.slice(0, 1).toUpperCase() || "P"}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold text-slate-200">{user?.name || "Palm member"}</p><p className="truncate text-[10px] text-slate-600">Personal workspace</p></div>
              <button onClick={logout} className="rounded-md px-1 text-[10px] font-medium text-slate-500 hover:text-slate-200">Exit</button>
            </div> : <button onClick={startLogin} className="flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.055]"><div className="grid size-7 place-items-center rounded-lg bg-violet-400/12 text-violet-300"><UserRound className="size-3.5" /></div><span className="text-[12px] font-semibold text-slate-300">Sign in to Palm</span></button>}
          </div>
        </aside>

        <section className="min-w-0 border-r border-white/[0.075] bg-[#0b0e17]/82 xl:min-h-screen">
          <div className="flex h-[78px] items-center justify-between border-b border-white/[0.075] px-5 sm:px-7">
            <div className="flex min-w-0 items-center gap-3 xl:hidden"><LogoMark /><span className="font-serif text-lg font-semibold tracking-tight">Palm.ai</span></div>
            <div className="hidden items-center gap-2 xl:flex"><span className="text-[11px] font-medium text-slate-500">{view === "workspace" ? "Action workspace" : view === "dashboard" ? "Personal overview" : view === "skills" ? "Capability controls" : "Workspace settings"}</span><span className="text-slate-700">/</span><span className="truncate text-[13px] font-semibold text-slate-200">{view === "workspace" ? currentTask?.title || "New action" : view === "dashboard" ? "Overview" : view === "skills" ? "Capabilities" : "Settings"}</span></div>
            <div className="ml-auto flex items-center gap-2.5"><div className="hidden items-center gap-2 rounded-full border border-emerald-300/10 bg-emerald-300/[0.055] px-2.5 py-1 sm:flex"><span className="size-1.5 animate-pulse rounded-full bg-emerald-300" /><span className="text-[10px] font-semibold text-emerald-200">Action engine ready</span></div><button className="grid size-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"><MoreHorizontal className="size-4" /></button></div>
          </div>

          <div className="grid grid-cols-4 border-b border-white/[0.075] bg-[#0b0e17]/80 px-3 py-2 xl:hidden">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = view === item.id;
              return <button key={item.id} onClick={() => setView(item.id)} className={cn("flex flex-col items-center gap-1 rounded-lg py-1.5 text-[9px] font-semibold transition-colors", isActive ? "bg-violet-400/10 text-violet-200" : "text-slate-600 hover:bg-white/[0.04] hover:text-slate-300")}><Icon className="size-3.5" />{item.label}</button>;
            })}
          </div>

          {view === "workspace" && <WorkspaceView
            isAuthenticated={isAuthenticated}
            isExecuting={isExecuting}
            currentTask={currentTask}
            messages={messages}
            pendingFiles={pendingFiles}
            attachmentRoute={attachmentRoute}
            setAttachmentRoute={setAttachmentRoute}
            localFileRunnerOnline={localFileRunnerOnline}
            executionTarget={executionTarget}
            setExecutionTarget={setExecutionTarget}
            localBrowserRunnerOnline={localBrowserRunnerOnline}
            attachedFiles={attachedFiles}
            composer={composer}
            setComposer={setComposer}
            onSubmit={submitTask}
            onSuggestedPrompt={prompt => setComposer(prompt)}
            onSelectFiles={() => fileInputRef.current?.click()}
            onFileChange={addFiles}
            inputRef={fileInputRef}
            onRemovePendingFile={id => setPendingFiles(files => files.filter(file => file.id !== id))}
            onDownload={downloadResult}
            onResume={() => currentTask && handleResume(currentTask.id)}
            latestRun={latestRun}
            waitingForLocalRunner={waitingForLocalRunner}
            localApproval={localApproval}
            onLocalApproval={handleLocalApproval}
            isDecidingApproval={decideLocalApproval.isPending}
            onCancel={handleCancel}
            isCancelling={cancelTask.isPending}
          />}
          {view === "dashboard" && <><DashboardView isAuthenticated={isAuthenticated} data={dashboardQuery.data} onOpenTask={id => { setActiveTaskId(id); setView("workspace"); }} /><PendingApprovalCountdowns isAuthenticated={isAuthenticated} /></>}
          {view === "skills" && <SkillsView isAuthenticated={isAuthenticated} skills={skillsQuery.data} isSaving={setSkill.isPending} onToggle={async (slug, enabled) => { if (!isAuthenticated) return startLogin(); try { await setSkill.mutateAsync({ skillSlug: slug, enabled }); await skillsQuery.refetch(); toast.success(`${enabled ? "Enabled" : "Paused"} capability.`); } catch { toast.error("Palm could not update this capability."); } }} />}
          {view === "settings" && <><SettingsView isAuthenticated={isAuthenticated} userName={user?.name} localRunners={localRunnersQuery.data ?? []} localRunnerToken={localRunnerToken} onRegisterLocalRunner={handleRegisterLocalRunner} onRenameLocalRunner={handleRenameLocalRunner} onRevokeLocalRunner={handleRevokeLocalRunner} isRegistering={registerLocalRunner.isPending} /><RunnerCommandCenter runners={localRunnerDashboardQuery.data?.runners ?? []} activity={localRunnerDashboardQuery.data?.activity ?? []} approvalExpiryMinutes={localRunnerDashboardQuery.data?.approvalSettings?.expiryMinutes ?? 15} onUpdateRunnerScope={handleRunnerScope} onSetApprovalExpiry={handleApprovalExpiry} isSaving={updateLocalRunnerScope.isPending || setLocalApprovalExpiry.isPending} /><AuditHistoryExplorer runners={localRunnerDashboardQuery.data?.runners ?? []} /><DeviceTimeoutOverrides runners={localRunnerDashboardQuery.data?.runners ?? []} defaultMinutes={localRunnerDashboardQuery.data?.approvalSettings?.expiryMinutes ?? 15} onSave={handleRunnerApprovalExpiryOverride} isSaving={setLocalRunnerApprovalExpiryOverride.isPending} /><DeviceCapabilityScopes runners={localRunnerDashboardQuery.data?.runners ?? []} onUpdateRunnerScope={handleRunnerScope} isSaving={updateLocalRunnerScope.isPending} /></>}
        </section>

        <aside className="hidden bg-[#0c0f18]/85 xl:flex xl:min-h-screen xl:flex-col">
          <div className="flex h-[78px] items-center justify-between border-b border-white/[0.075] px-5"><div><p className="text-[13px] font-semibold text-slate-200">Execution trace</p><p className="mt-1 text-[10px] text-slate-600">Live workflow context</p></div><div className="flex items-center gap-1.5 rounded-full bg-violet-400/10 px-2.5 py-1"><span className={cn("size-1.5 rounded-full", isExecuting ? "animate-pulse bg-violet-300" : "bg-slate-600")} /><span className="text-[10px] font-bold text-violet-200">{isExecuting ? "LIVE" : "IDLE"}</span></div></div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-5">
              {view === "workspace" ? <TraceView steps={displayedSteps} runnerEvents={runnerEvents} latestRun={latestRun} isExecuting={isExecuting || runnerIsActive} taskTitle={currentTask?.title} /> : <ContextPanel view={view} skillsEnabled={skillsQuery.data?.filter(skill => skill.enabled).length ?? 0} />}
            </div>
          </ScrollArea>
          <div className="border-t border-white/[0.075] p-5"><div className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4"><div className="flex items-center gap-2 text-[11px] font-semibold text-slate-300"><ShieldCheck className="size-3.5 text-emerald-300" /> Workspace safeguards</div><p className="mt-2 text-[10px] leading-relaxed text-slate-600">Palm records the observable workflow and protects access to your saved task context.</p></div></div>
        </aside>
      </main>
    </div>
  );
}

function WorkspaceView(props: {
  isAuthenticated: boolean; isExecuting: boolean; currentTask: any; messages: any[]; pendingFiles: PendingFile[]; attachedFiles: any[]; composer: string; setComposer: (value: string) => void; onSubmit: () => void; onSuggestedPrompt: (value: string) => void; onSelectFiles: () => void; onFileChange: (files: FileList | null) => void; inputRef: React.RefObject<HTMLInputElement | null>; onRemovePendingFile: (id: string) => void; onDownload: () => void; onResume: () => void; latestRun: any; waitingForLocalRunner: boolean; localApproval: any; onLocalApproval: (decision: "approved" | "rejected") => void; isDecidingApproval: boolean; onCancel: () => void; isCancelling: boolean; attachmentRoute: "local" | "cloud"; setAttachmentRoute: (value: "local" | "cloud") => void; localFileRunnerOnline: boolean; executionTarget: "auto" | "local_browser"; setExecutionTarget: (value: "auto" | "local_browser") => void; localBrowserRunnerOnline: boolean;
}) {
  const hasTask = Boolean(props.currentTask);
  return <div className="flex min-h-[calc(100vh-78px)] flex-col">
    <ScrollArea className="min-h-0 flex-1"><div className="mx-auto w-full max-w-4xl px-5 pb-8 pt-10 sm:px-10">
      {hasTask ? <div className="mx-auto max-w-3xl">
        <div className="mb-10 flex items-start justify-between gap-4"><div><div className="mb-3 flex items-center gap-2"><StatusChip status={props.currentTask.status} /><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Action #{props.currentTask.id}</span></div><h1 className="max-w-2xl font-serif text-3xl font-medium tracking-[-0.045em] text-white sm:text-[34px]">{props.currentTask.title}</h1></div>{props.currentTask.assistantResponse && <Button onClick={props.onDownload} variant="ghost" className="h-9 shrink-0 gap-2 rounded-lg text-[11px] text-slate-400 hover:bg-white/[0.06] hover:text-white"><Download className="size-3.5" /> Export</Button>}</div>
        <div className="space-y-7">{props.messages.map(message => <div key={message.id} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
          {message.role === "assistant" && <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-300 to-indigo-400 text-slate-950"><Sparkles className="size-3.5" /></div>}
          <div className={cn("max-w-[88%]", message.role === "user" ? "rounded-2xl rounded-tr-md border border-white/[0.08] bg-white/[0.045] px-4 py-3" : "pt-0.5")}>
            {message.role === "user" ? <p className="whitespace-pre-wrap text-[13px] leading-6 text-slate-200">{message.content}</p> : <div className="palm-prose prose prose-invert max-w-none text-[13px] leading-7 text-slate-300"><Streamdown>{message.content}</Streamdown></div>}
          </div>
        </div>)}</div>
        {(props.isExecuting || props.latestRun || props.waitingForLocalRunner) && <RunnerStatusCard run={props.latestRun} isExecuting={props.isExecuting} waitingForLocalRunner={props.waitingForLocalRunner} onCancel={props.onCancel} isCancelling={props.isCancelling} />}
        {props.localApproval?.status === "pending" && <LocalApprovalCard policyJson={props.localApproval.policyJson} expiresAt={props.localApproval.expiresAt} onDecision={props.onLocalApproval} isDeciding={props.isDecidingApproval} />}
        {props.localApproval?.status === "expired" && <div className="mt-8 rounded-2xl border border-rose-300/20 bg-rose-300/[0.05] p-4"><div className="flex items-start gap-3"><Clock3 className="mt-0.5 size-4 text-rose-200" /><div><p className="text-[12px] font-semibold text-rose-100">Sensitive local action timed out</p><p className="mt-1 text-[10px] leading-5 text-rose-100/60">The required approval expired before Palm released this task to a device. Create a fresh continuation if you still want to proceed.</p></div></div></div>}
        {props.attachedFiles.length > 0 && <div className="mt-10 border-t border-white/[0.075] pt-6"><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-600">Task context</p><div className="flex flex-wrap gap-2">{props.attachedFiles.map(file => file.source === "local_reference" ? <div key={file.id} className="flex items-center gap-2 rounded-xl border border-emerald-300/[0.14] bg-emerald-300/[0.035] px-3 py-2 text-[11px] text-emerald-100"><FileText className="size-3.5 text-emerald-300" />{file.originalName}<span className="rounded bg-emerald-300/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-emerald-200">Local only</span></div> : <a key={file.id} href={file.storageUrl} target="_blank" className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[11px] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"><FileText className="size-3.5 text-violet-300" />{file.originalName}<Download className="size-3 text-slate-600" /></a>)}</div></div>}
        {props.currentTask.status === "error" && <button onClick={props.onResume} className="mt-8 flex items-center gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[0.055] px-4 py-3 text-left text-[12px] text-rose-100 hover:bg-rose-300/[0.09]"><Workflow className="size-4" /> This workflow needs review. Create a fresh continuation.</button>}
      </div> : <EmptyWorkspace onSuggestedPrompt={props.onSuggestedPrompt} />}
    </div></ScrollArea>
    <Composer {...props} />
  </div>;
}

export function RunnerStatusCard({ run, isExecuting, waitingForLocalRunner, onCancel, isCancelling }: { run: any; isExecuting: boolean; waitingForLocalRunner: boolean; onCancel: () => void; isCancelling: boolean }) {
  const terminal = !run || ["completed", "failed", "cancelled"].includes(run.status);
  const isLocal = run?.provider === "local";
  const label = waitingForLocalRunner ? "Queued for your Local Runner" : isLocal ? (run?.status === "running" ? "Local Runner is executing" : run?.status === "collecting" ? "Local Runner is collecting results" : "Local Runner evidence available") : run?.status === "dispatching" ? "Dispatching GitHub Actions runner" : run?.status === "provisioning" ? "Provisioning GitHub Actions workflow" : run?.status === "running" ? "GitHub Actions runner is executing" : run?.status === "collecting" ? "Collecting verified artifacts" : run?.status === "cancellation_requested" ? "Stopping runner" : isExecuting ? "Preparing action" : "Runner evidence available";
  return <div className="mt-8 rounded-2xl border border-cyan-300/[0.13] bg-cyan-300/[0.035] p-4 shadow-[0_12px_38px_rgba(0,0,0,0.12)]"><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><div className="grid size-8 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200"><Zap className="size-4" /></div><div><p className="text-[12px] font-semibold text-cyan-50">{label}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{waitingForLocalRunner ? "Palm will remain queued until the local-runner script on your machine claims this task." : isLocal ? "Your own machine claimed this task. Palm records only the evidence and result it reports." : run?.githubWorkflowRunId ? `GitHub Actions workflow ${run.githubWorkflowRunId}` : "A time-boxed GitHub Actions runner processes cloud-uploaded attachments only."}</p></div></div>{run && !terminal && !isLocal && <Button onClick={onCancel} disabled={isCancelling || run.status === "cancellation_requested"} variant="ghost" className="h-8 shrink-0 rounded-lg border border-rose-300/15 bg-rose-300/[0.04] px-2.5 text-[10px] text-rose-200 hover:bg-rose-300/[0.1]">{isCancelling ? <Loader2 className="size-3 animate-spin" /> : "Stop"}</Button>}</div><div className="mt-3 flex flex-wrap gap-2">{isLocal || waitingForLocalRunner ? <><span className="rounded-md bg-white/[0.045] px-2 py-1 text-[9px] font-medium text-slate-400">Your own machine</span><span className="rounded-md bg-white/[0.045] px-2 py-1 text-[9px] font-medium text-slate-400">$0 cloud execution</span></> : <><span className="rounded-md bg-white/[0.045] px-2 py-1 text-[9px] font-medium text-slate-400">15 min maximum</span><span className="rounded-md bg-white/[0.045] px-2 py-1 text-[9px] font-medium text-slate-400">No public ingress</span></>}<span className="rounded-md bg-white/[0.045] px-2 py-1 text-[9px] font-medium text-slate-400">Evidence required</span></div></div>;
}

function EmptyWorkspace({ onSuggestedPrompt }: { onSuggestedPrompt: (value: string) => void }) {
  return <div className="mx-auto flex min-h-[420px] max-w-3xl flex-col justify-center pb-10"><div className="mb-7 inline-flex size-11 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-400/[0.09] shadow-[0_0_50px_rgba(139,92,246,0.15)]"><Bot className="size-5 text-violet-200" /></div><p className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-violet-300">Palm action engine</p><h1 className="max-w-2xl font-serif text-4xl font-medium leading-[1.07] tracking-[-0.055em] text-white sm:text-5xl">Delegate the work.<br /><span className="text-slate-500">Observe the momentum.</span></h1><p className="mt-5 max-w-xl text-[14px] leading-7 text-slate-500">Describe the outcome you need. Palm will frame an observable workflow, coordinate the available workspace capabilities, and return a focused deliverable.</p><div className="mt-9 grid gap-2 sm:grid-cols-3">{suggestedObjectives.map((prompt, index) => <button key={prompt} onClick={() => onSuggestedPrompt(prompt)} className="group rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-violet-300/20 hover:bg-violet-400/[0.055]"><span className="mb-4 block text-[10px] font-bold text-slate-600">0{index + 1}</span><p className="text-[12px] leading-5 text-slate-400 group-hover:text-slate-200">{prompt}</p><ArrowUp className="mt-4 size-3.5 text-slate-600 transition-transform group-hover:-translate-y-0.5 group-hover:text-violet-300" /></button>)}</div></div>;
}

function Composer(props: { isAuthenticated: boolean; isExecuting: boolean; pendingFiles: PendingFile[]; composer: string; setComposer: (value: string) => void; onSubmit: () => void; onSelectFiles: () => void; onFileChange: (files: FileList | null) => void; inputRef: React.RefObject<HTMLInputElement | null>; onRemovePendingFile: (id: string) => void; attachmentRoute: "local" | "cloud"; setAttachmentRoute: (value: "local" | "cloud") => void; localFileRunnerOnline: boolean; executionTarget: "auto" | "local_browser"; setExecutionTarget: (value: "auto" | "local_browser") => void; localBrowserRunnerOnline: boolean }) {
  return <div className="border-t border-white/[0.075] bg-[#0b0e17]/90 px-5 py-4 backdrop-blur-xl sm:px-10"><div className="mx-auto max-w-4xl"><input ref={props.inputRef} onChange={event => { props.onFileChange(event.target.files); event.currentTarget.value = ""; }} type="file" multiple accept=".pdf,.txt,.md,.csv,.doc,.docx,.png,.jpg,.jpeg,.webp" className="hidden" />
    {props.pendingFiles.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{props.pendingFiles.map(item => <div key={item.id} className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] py-1.5 pl-2.5 pr-1.5 text-[10px] text-slate-400"><FileText className="size-3 text-violet-300" /><span className="max-w-36 truncate">{item.file.name}</span><button onClick={() => props.onRemovePendingFile(item.id)} className="grid size-4 place-items-center rounded text-slate-600 hover:bg-white/10 hover:text-slate-200"><X className="size-3" /></button></div>)}</div>}
    <div className="rounded-2xl border border-white/[0.1] bg-white/[0.035] p-2 shadow-[0_16px_50px_rgba(0,0,0,0.18)] transition-colors focus-within:border-violet-300/30 focus-within:bg-white/[0.045]"><Textarea value={props.composer} onChange={event => props.setComposer(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); props.onSubmit(); } }} placeholder={props.isAuthenticated ? "Describe the outcome you want Palm to drive…" : "Sign in to delegate your first action…"} className="min-h-[58px] resize-none border-0 bg-transparent px-2 py-2 text-[13px] leading-6 text-slate-200 placeholder:text-slate-600 focus-visible:ring-0" disabled={props.isExecuting} />
      <div className="flex flex-wrap items-center justify-between gap-2 px-1"><div className="flex items-center gap-1"><button onClick={props.onSelectFiles} disabled={props.isExecuting || props.executionTarget === "local_browser"} className="grid size-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-white/[0.07] hover:text-violet-200 disabled:opacity-50" aria-label="Attach supporting files"><Paperclip className="size-4" /></button><span className="hidden text-[10px] text-slate-600 sm:inline">Attach task context</span>{props.pendingFiles.length > 0 && <button onClick={() => props.setAttachmentRoute(props.attachmentRoute === "local" ? "cloud" : "local")} disabled={!props.localFileRunnerOnline || props.isExecuting} className={cn("ml-1 rounded-md px-2 py-1 text-[9px] font-semibold transition-colors", props.attachmentRoute === "local" ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.05] text-slate-500", (!props.localFileRunnerOnline || props.isExecuting) && "cursor-not-allowed opacity-50")} title={props.localFileRunnerOnline ? "Switch attachment route" : "Connect a file Local Runner to keep attachments local"}>{props.attachmentRoute === "local" ? "Local-only" : "Cloud upload"}</button>}<button onClick={() => props.setExecutionTarget(props.executionTarget === "local_browser" ? "auto" : "local_browser")} disabled={!props.localBrowserRunnerOnline || props.pendingFiles.length > 0 || props.isExecuting} className={cn("ml-1 rounded-md px-2 py-1 text-[9px] font-semibold transition-colors", props.executionTarget === "local_browser" ? "bg-cyan-300/10 text-cyan-100" : "bg-white/[0.05] text-slate-500", (!props.localBrowserRunnerOnline || props.pendingFiles.length > 0 || props.isExecuting) && "cursor-not-allowed opacity-50")} title={props.localBrowserRunnerOnline ? "Use Local Browser Runner" : "Connect a Local Browser Runner to enable browser tasks"}>Browser task</button></div><Button onClick={props.onSubmit} disabled={!props.composer.trim() || props.isExecuting} className="h-8 gap-2 rounded-lg bg-violet-300 px-3.5 text-[11px] font-bold text-slate-950 hover:bg-violet-200 disabled:bg-white/[0.08] disabled:text-slate-600">{props.isExecuting ? <><Loader2 className="size-3.5 animate-spin" /> Working</> : <><Zap className="size-3.5" /> Run action</>}</Button></div>
    </div><p className="mt-2 text-center text-[9px] text-slate-700">{props.pendingFiles.length > 0 && props.attachmentRoute === "local" && props.localFileRunnerOnline ? "Local-only attachments remain on your device; Palm receives a scoped filename reference, not file bytes." : props.executionTarget === "local_browser" ? "Browser tasks run on your connected machine. Write actions pause for approval." : "Palm records observable execution context. Review important outputs before acting on them."}</p></div></div>;
}

function TraceView({ steps, runnerEvents, latestRun, isExecuting, taskTitle }: { steps: any[]; runnerEvents: any[]; latestRun: any; isExecuting: boolean; taskTitle?: string }) {
  return <><div className="mb-6 rounded-2xl border border-violet-300/[0.12] bg-gradient-to-br from-violet-400/[0.08] to-transparent p-4"><div className="flex items-center gap-2"><div className="grid size-7 place-items-center rounded-lg bg-violet-300 text-slate-950"><Workflow className="size-3.5" /></div><div><p className="text-[11px] font-semibold text-violet-100">{isExecuting ? "Workflow in motion" : "Workflow posture"}</p><p className="mt-0.5 text-[10px] text-violet-200/50">{taskTitle ? "Observable action context" : "Awaiting a delegated objective"}</p></div></div></div>
  {steps.length ? <div className="relative space-y-0">{steps.map((step, index) => <div key={step.id} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-6 last:pb-0"><div className="relative z-10 grid size-7 place-items-center rounded-lg border text-slate-500" style={{ borderColor: step.status === "running" ? "rgba(196,181,253,0.45)" : step.status === "completed" ? "rgba(110,231,183,0.28)" : "rgba(255,255,255,0.08)", background: step.status === "running" ? "rgba(139,92,246,0.16)" : step.status === "completed" ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.025)" }}><ToolGlyph kind={step.kind} /></div>{index !== steps.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-4px)] w-px bg-white/[0.075]" />}<div className="min-w-0 pt-0.5"><div className="flex items-start justify-between gap-2"><p className={cn("text-[11px] font-semibold", step.status === "pending" ? "text-slate-500" : "text-slate-200")}>{step.label}</p>{step.status === "running" ? <Loader2 className="mt-0.5 size-3 animate-spin text-violet-300" /> : step.status === "completed" ? <Check className="mt-0.5 size-3 text-emerald-300" /> : <Circle className="mt-0.5 size-2.5 text-slate-700" />}</div><p className="mt-1 text-[10px] leading-4 text-slate-600">{step.detail}</p>{step.toolName && <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2 py-1 text-[9px] font-medium text-slate-500"><Code2 className="size-2.5" />{step.toolName}</div>}</div></div>)}</div> : <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-6 text-center"><Clock3 className="mx-auto size-4 text-slate-600" /><p className="mt-3 text-[11px] font-medium text-slate-500">No active trace</p><p className="mt-1 text-[10px] leading-4 text-slate-700">The plan, capability decisions, and result preparation will appear here as Palm works.</p></div>}
  {runnerEvents.length > 0 && <div className="mt-8 border-t border-white/[0.075] pt-5"><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">Runner evidence</p><div className="space-y-3">{runnerEvents.map(event => <div key={event.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold text-cyan-100">{event.type.replace(/\./g, " ")}</span><span className="text-[9px] uppercase tracking-[0.1em] text-slate-600">{event.source}</span></div><p className="mt-1 text-[10px] leading-4 text-slate-500">{event.detail}</p></div>)}</div></div>}
  <div className="mt-8 border-t border-white/[0.075] pt-5"><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">Session context</p><div className="space-y-3"><div className="flex items-center justify-between text-[10px]"><span className="text-slate-600">Scope</span><span className="font-medium text-slate-400">Current workspace</span></div><div className="flex items-center justify-between text-[10px]"><span className="text-slate-600">Runner</span><span className="font-medium text-slate-400">{latestRun?.provider === "github_actions" ? "GitHub Actions" : latestRun?.provider === "local" ? "Palm Local Runner" : "Palm built-in runtime"}</span></div><div className="flex items-center justify-between text-[10px]"><span className="text-slate-600">Capabilities</span><span className="font-medium text-slate-400">User-controlled</span></div></div></div></>;
}

function PendingApprovalCountdowns({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const approvalsQuery = trpc.palm.pendingLocalApprovals.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 15_000 });
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  if (!isAuthenticated) return null;
  const urgent = (approvalsQuery.data ?? []).filter(approval => isApprovalNearExpiry(approval.expiresAt, now));
  if (!urgent.length) return null;
  const labelFor = (expiresAt: Date | string) => formatApprovalCountdown(expiresAt, now);
  return <section className="mx-auto max-w-4xl px-5 pb-12 sm:px-10"><div className="rounded-2xl border border-rose-300/[0.18] bg-rose-300/[0.04] p-5"><div className="flex items-start gap-3"><div className="grid size-9 place-items-center rounded-xl bg-rose-300/10 text-rose-200"><Clock3 className="size-4" /></div><div><p className="text-[12px] font-semibold text-rose-50">Approvals nearing expiry</p><p className="mt-1 text-[10px] leading-5 text-rose-100/60">These sensitive Local Runner actions need a decision soon. Countdown values reflect Palm’s durable expiry timestamps.</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-2">{urgent.map(approval => { const remaining = approvalRemainingMs(approval.expiresAt, now); const progress = Math.min(100, (remaining / (10 * 60_000)) * 100); let reason = "Sensitive Local Runner action"; try { reason = JSON.parse(approval.policyJson).approvalReason || reason; } catch { /* use safe fallback */ } return <div key={approval.id} className="rounded-xl border border-rose-200/[0.1] bg-black/15 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-[11px] font-semibold text-slate-100">{approval.taskTitle}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{reason}</p></div><span className="shrink-0 font-mono text-lg font-semibold text-rose-200">{labelFor(approval.expiresAt)}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-rose-300/10"><div className="h-full rounded-full bg-rose-300 transition-[width] duration-1000" style={{ width: `${progress}%` }} /></div></div>; })}</div></div></section>;
}

function DashboardView({ isAuthenticated, data, onOpenTask }: { isAuthenticated: boolean; data: any; onOpenTask: (id: number) => void }) {
  if (!isAuthenticated) return <SignedOutPanel icon={LayoutDashboard} title="Your action overview" body="Sign in to see personal task history, capability usage, and the actions currently in motion." />;
  const totals = data?.totals ?? { tasks: 0, completed: 0, running: 0, activeSkills: 0 };
  const cards = [{ label: "Total actions", value: totals.tasks, icon: Workflow, tone: "text-violet-200" }, { label: "Completed", value: totals.completed, icon: Check, tone: "text-emerald-300" }, { label: "In motion", value: totals.running, icon: Zap, tone: "text-cyan-200" }, { label: "Active capabilities", value: totals.activeSkills, icon: Sparkles, tone: "text-amber-200" }];
  return <div className="mx-auto max-w-4xl px-5 py-10 sm:px-10"><div className="mb-9"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-300">Personal control room</p><h1 className="mt-3 font-serif text-4xl tracking-[-0.05em] text-white">Activity with intent.</h1><p className="mt-3 max-w-lg text-[13px] leading-6 text-slate-500">A concise view of the work you have delegated and the capabilities available in this workspace.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(card => { const Icon = card.icon; return <div key={card.label} className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4"><Icon className={cn("size-4", card.tone)} /><p className="mt-7 text-2xl font-semibold tracking-tight text-white">{card.value}</p><p className="mt-1 text-[10px] font-medium text-slate-600">{card.label}</p></div>})}</div><div className="mt-9 rounded-2xl border border-white/[0.075] bg-white/[0.02] p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-[13px] font-semibold text-slate-200">Recent actions</p><p className="mt-1 text-[10px] text-slate-600">Return to a workflow at any point.</p></div><Archive className="size-4 text-slate-600" /></div><div className="divide-y divide-white/[0.055]">{data?.recentTasks?.length ? data.recentTasks.map((task: any) => <button key={task.id} onClick={() => onOpenTask(task.id)} className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-white/[0.025]"><div className="grid size-8 place-items-center rounded-lg bg-white/[0.045]"><Workflow className="size-3.5 text-violet-300" /></div><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium text-slate-300">{task.title}</p><p className="mt-1 text-[10px] text-slate-600">{formatTime(task.updatedAt)}</p></div><StatusChip status={task.status} /></button>) : <div className="py-10 text-center text-[11px] text-slate-600">Your completed work will appear here.</div>}</div></div></div>;
}

function SkillsView({ isAuthenticated, skills, isSaving, onToggle }: { isAuthenticated: boolean; skills: any[] | undefined; isSaving: boolean; onToggle: (slug: string, enabled: boolean) => void }) {
  if (!isAuthenticated) return <SignedOutPanel icon={Sparkles} title="Choose Palm’s capabilities" body="Sign in to tune the capabilities Palm can consider for your personal workspace." />;
  return <div className="mx-auto max-w-4xl px-5 py-10 sm:px-10"><div className="mb-9"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-300">Capability controls</p><h1 className="mt-3 font-serif text-4xl tracking-[-0.05em] text-white">Purposeful by default.</h1><p className="mt-3 max-w-xl text-[13px] leading-6 text-slate-500">Control which categories Palm may consider while planning your next objective. This release records your preferences and uses them as live task context.</p></div><div className="grid gap-3 sm:grid-cols-2">{skills?.map(skill => { const iconMap: Record<string, typeof Globe2> = { Globe2, FileSearch, Code2, ChartNoAxesCombined: BarChart3, Sparkles, Workflow }; const Icon = iconMap[skill.icon] || Sparkles; return <div key={skill.slug} className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-5 transition-colors hover:border-white/[0.12]"><div className="flex items-start justify-between gap-4"><div className="grid size-9 place-items-center rounded-xl bg-violet-400/[0.09] text-violet-200"><Icon className="size-4" /></div><Switch checked={skill.enabled} onCheckedChange={enabled => onToggle(skill.slug, enabled)} disabled={isSaving} aria-label={`Toggle ${skill.name}`} /></div><p className="mt-5 text-[13px] font-semibold text-slate-200">{skill.name}</p><p className="mt-1.5 text-[11px] leading-5 text-slate-600">{skill.description}</p><div className="mt-4 text-[9px] font-bold uppercase tracking-[0.13em] text-slate-700">{skill.category}</div></div>})}</div></div>;
}

function SettingsView({ isAuthenticated, userName, localRunners, localRunnerToken, onRegisterLocalRunner, onRenameLocalRunner, onRevokeLocalRunner, isRegistering }: { isAuthenticated: boolean; userName?: string | null; localRunners: any[]; localRunnerToken: string | null; onRegisterLocalRunner: (runnerType?: "file" | "browser") => void; onRenameLocalRunner: (runnerId: number, label: string) => void; onRevokeLocalRunner: (runnerId: number) => void; isRegistering: boolean }) {
  const [editingRunnerId, setEditingRunnerId] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  if (!isAuthenticated) return <SignedOutPanel icon={Settings2} title="Workspace settings" body="Sign in to access your profile and personal workspace controls." />;
  const online = localRunners.find(runner => runner.status === "online");
  return <div className="mx-auto max-w-3xl px-5 py-10 sm:px-10"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-300">Workspace settings</p><h1 className="mt-3 font-serif text-4xl tracking-[-0.05em] text-white">A considered workspace.</h1><div className="mt-9 space-y-3"><div className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-5"><div className="flex items-center justify-between"><div><p className="text-[13px] font-semibold text-slate-200">Profile</p><p className="mt-1 text-[11px] text-slate-600">{userName || "Palm member"}</p></div><Avatar className="size-9 border border-white/10"><AvatarFallback className="bg-violet-300 text-xs font-bold text-slate-950">{userName?.slice(0, 1).toUpperCase() || "P"}</AvatarFallback></Avatar></div></div><div className="rounded-2xl border border-emerald-300/[0.12] bg-emerald-300/[0.025] p-5"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Zap className="size-4 text-emerald-300" /><p className="text-[13px] font-semibold text-slate-100">Local Runners</p></div><p className="mt-2 max-w-xl text-[11px] leading-5 text-slate-500">Run Palm work on your own machine. File runners can reference matching files in <code>PALM_INPUT_DIR</code> without uploading their bytes. Browser runners keep evidence on-device and pause before browser writes.</p></div><span className={cn("rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em]", online ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.06] text-slate-500")}>{online ? "Online" : "Offline"}</span></div>{localRunnerToken ? <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.045] p-3"><p className="text-[10px] font-semibold text-amber-100">Copy this token now — it is shown only in this session.</p><code className="mt-2 block break-all rounded-lg bg-black/20 px-3 py-2 text-[10px] text-amber-200">{localRunnerToken}</code></div> : <div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => onRegisterLocalRunner("file")} disabled={isRegistering} className="h-9 rounded-lg bg-emerald-300 px-3.5 text-[11px] font-bold text-slate-950 hover:bg-emerald-200">{isRegistering ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3.5" />} Create file-runner token</Button><Button onClick={() => onRegisterLocalRunner("browser")} disabled={isRegistering} variant="outline" className="h-9 rounded-lg border-cyan-300/20 bg-cyan-300/[0.05] px-3.5 text-[11px] font-bold text-cyan-100 hover:bg-cyan-300/[0.1]">Create browser-runner token</Button></div>}<div className="mt-5 space-y-2 border-t border-white/[0.07] pt-4">{localRunners.length ? localRunners.map(runner => <div key={runner.id} className="rounded-xl bg-black/15 p-3"><div className="flex items-center gap-3"><span className={cn("size-2 rounded-full", runner.status === "online" ? "bg-emerald-300" : runner.status === "revoked" ? "bg-rose-300" : "bg-slate-600")} /><div className="min-w-0 flex-1">{editingRunnerId === runner.id ? <Input aria-label="Local Runner name" value={draftLabel} onChange={event => setDraftLabel(event.target.value)} className="h-7 border-white/[0.12] bg-white/[0.04] text-[11px] text-slate-100" autoFocus /> : <p className="truncate text-[11px] font-semibold text-slate-200">{runner.label}</p>}<p className="text-[9px] uppercase tracking-[0.12em] text-slate-600">{runner.runnerType === "browser" ? "Browser runner · " : "File runner · "}{runner.status}{runner.lastSeenAt ? ` · seen ${formatTime(runner.lastSeenAt)}` : ""}</p></div>{editingRunnerId === runner.id ? <><button onClick={() => { if (draftLabel.trim()) onRenameLocalRunner(runner.id, draftLabel.trim()); setEditingRunnerId(null); }} className="text-[10px] text-emerald-200 hover:text-white">Save</button><button onClick={() => setEditingRunnerId(null)} className="text-[10px] text-slate-500 hover:text-slate-200">Cancel</button></> : <button onClick={() => { setEditingRunnerId(runner.id); setDraftLabel(runner.label); }} className="text-[10px] text-violet-200 hover:text-white">Rename</button>}{runner.status !== "revoked" && <button onClick={() => onRevokeLocalRunner(runner.id)} className="text-[10px] text-rose-200 hover:text-rose-100">Revoke</button>}</div></div>) : <p className="text-[10px] text-slate-600">No registered devices yet.</p>}</div><p className="mt-3 text-[10px] leading-5 text-slate-600">Use <code>palm-local-runner.sh</code> for file work or <code>palm-local-browser-runner.mjs</code> for browser work. Both use the same audited protocol; no Azure, VM, or paid sandbox is required.</p></div><div className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-5"><p className="text-[13px] font-semibold text-slate-200">Attachment privacy</p><p className="mt-1 text-[11px] leading-5 text-slate-600">When a file Local Runner is connected, choose Local-only in the composer. Palm stores only the filename and scoped <code>PALM_INPUT_DIR</code> reference; the selected file’s bytes are not uploaded and cannot be downloaded from the workflow.</p></div></div></div>;
}

const runnerToolLabels: Record<string, string> = {
  inventory_files: "Inventory files",
  extract_text_metadata: "Extract text metadata",
  profile_csv: "Profile CSV files",
  write_result_record: "Write a result record",
};

const runnerSkillLabels: Record<string, string> = {
  "web-research": "Web research",
  "document-intelligence": "Document intelligence",
  "code-workspace": "Code workspace",
  "data-analysis": "Data analysis",
  "visual-creation": "Visual creation",
  "workflow-automation": "Workflow automation",
};

const runnerActionLabels: Record<string, string> = {
  file_mutation: "File mutation",
  external_sharing: "External sharing",
  command_execution: "Command execution",
  browser_control: "Browser control",
};

const browserToolLabels: Record<string, string> = {
  open_tab: "Open tab",
  navigate: "Navigate",
  screenshot: "Capture screenshot",
  read_page_text: "Read page text",
  close_tab: "Close tab",
  click_element: "Click element",
  type_text: "Type text",
  submit_form: "Submit form",
};

function RunnerCommandCenter({ runners, activity, approvalExpiryMinutes, onUpdateRunnerScope, onSetApprovalExpiry, isSaving }: { runners: any[]; activity: any[]; approvalExpiryMinutes: number; onUpdateRunnerScope: (runnerId: number, allowedTools: string[], requiresApprovalForSensitive: boolean, allowedSkillSlugs?: string[], allowedSensitiveActions?: string[], allowedBrowserTools?: string[], navigationAllowlist?: string[], requiresApprovalForBrowserWrites?: boolean) => void; onSetApprovalExpiry: (minutes: number) => void; isSaving: boolean }) {
  const [expiryMinutes, setExpiryMinutes] = useState(String(approvalExpiryMinutes));
  useEffect(() => setExpiryMinutes(String(approvalExpiryMinutes)), [approvalExpiryMinutes]);
  const onlineCount = runners.filter(runner => runner.connectionStatus === "online").length;
  return <section className="mx-auto max-w-3xl px-5 pb-12 sm:px-10"><div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300">Local Runner command center</p><h2 className="mt-2 font-serif text-3xl tracking-[-0.045em] text-white">Devices with boundaries.</h2></div><div className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-1.5 text-[10px] font-semibold text-cyan-100"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-cyan-300" />{onlineCount}/{runners.length} online</div></div><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-600">Connected now</p><p className="mt-4 text-2xl font-semibold text-white">{onlineCount}</p><p className="mt-1 text-[10px] text-slate-500">Updates every 10 seconds</p></div><div className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-600">Registered devices</p><p className="mt-4 text-2xl font-semibold text-white">{runners.length}</p><p className="mt-1 text-[10px] text-slate-500">Revoked devices remain auditable</p></div><div className="rounded-2xl border border-amber-300/[0.12] bg-amber-300/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-amber-200/70">Approval timeout</p><div className="mt-2 flex items-center gap-2"><Input aria-label="Approval timeout in minutes" type="number" min="1" max="1440" value={expiryMinutes} onChange={event => setExpiryMinutes(event.target.value)} className="h-8 w-20 border-amber-300/20 bg-black/15 text-[11px] text-amber-50" /><span className="text-[10px] text-amber-100/60">minutes</span><button onClick={() => { const minutes = Number(expiryMinutes); if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440) onSetApprovalExpiry(minutes); }} disabled={isSaving} className="text-[10px] font-semibold text-amber-100 hover:text-white disabled:opacity-50">Save</button></div><p className="mt-2 text-[9px] leading-4 text-slate-600">Expiry is enforced whenever the workspace or a device checks the request.</p></div></div><div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_310px]"><div className="space-y-3">{runners.length ? runners.map(runner => <RunnerScopeCard key={runner.id} runner={runner} onSave={onUpdateRunnerScope} isSaving={isSaving} />) : <div className="rounded-2xl border border-dashed border-white/[0.09] p-6 text-center text-[11px] text-slate-600">Register a Local Runner to configure a device-specific execution scope.</div>}</div><div className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4"><div className="flex items-center justify-between"><div><p className="text-[12px] font-semibold text-slate-200">Recent audit history</p><p className="mt-1 text-[10px] text-slate-600">Durable device and approval events</p></div><Clock3 className="size-4 text-violet-300" /></div><div className="mt-4 space-y-3">{activity.length ? activity.slice(0, 8).map(event => <div key={event.id} className="border-l border-white/[0.09] pl-3"><p className="text-[10px] font-medium text-slate-300">{event.detail}</p><p className="mt-1 text-[9px] uppercase tracking-[0.11em] text-slate-600">{event.eventType.replace(/\./g, " ")} · {formatTime(event.createdAt)}</p></div>) : <p className="py-5 text-center text-[10px] text-slate-600">Device activity will appear here.</p>}</div></div></div></section>;
}

function BasicAuditHistoryExplorer({ runners }: { runners: any[] }) {
  const [runnerId, setRunnerId] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const filterInput = useMemo(() => ({
    ...(runnerId !== "all" ? { runnerId: Number(runnerId) } : {}),
    ...(eventType !== "all" ? { eventType } : {}),
    ...(startDate ? { startAt: new Date(`${startDate}T00:00:00`) } : {}),
    ...(endDate ? { endAt: new Date(`${endDate}T23:59:59.999`) } : {}),
  }), [runnerId, eventType, startDate, endDate]);
  const auditQuery = trpc.palm.localRunnerAudit.useQuery(filterInput, { refetchInterval: 10_000 });
  const eventTypes = useMemo(() => Array.from(new Set(auditQuery.data?.map(event => event.eventType) ?? [])).sort(), [auditQuery.data]);
  const exportCsv = () => {
    const labels = new Map(runners.map(runner => [runner.id, runner.label]));
    const csv = serializeAuditCsv(auditQuery.data ?? [], labels);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `palm-local-runner-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <section className="mx-auto max-w-3xl px-5 pb-12 sm:px-10"><div className="rounded-2xl border border-cyan-300/[0.12] bg-cyan-300/[0.02] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-cyan-300">Audit history</p><h3 className="mt-2 font-serif text-2xl tracking-[-0.04em] text-white">Interrogate the evidence trail.</h3><p className="mt-2 max-w-xl text-[11px] leading-5 text-slate-500">Filter durable device and approval events, then export the currently visible results for external review.</p></div><Button onClick={exportCsv} disabled={!auditQuery.data?.length} className="h-9 rounded-lg bg-cyan-200 px-3 text-[10px] font-bold text-slate-950 hover:bg-cyan-100 disabled:bg-white/[0.08] disabled:text-slate-600"><Download className="mr-1.5 size-3.5" />Export CSV</Button></div><div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><select aria-label="Filter audit history by device" value={runnerId} onChange={event => setRunnerId(event.target.value)} className="h-9 rounded-lg border border-white/[0.1] bg-black/20 px-2.5 text-[10px] text-slate-300 outline-none focus:border-cyan-300/50"><option value="all">All devices</option>{runners.map(runner => <option key={runner.id} value={runner.id}>{runner.label}</option>)}</select><select aria-label="Filter audit history by event type" value={eventType} onChange={event => setEventType(event.target.value)} className="h-9 rounded-lg border border-white/[0.1] bg-black/20 px-2.5 text-[10px] text-slate-300 outline-none focus:border-cyan-300/50"><option value="all">All event types</option>{eventTypes.map(type => <option key={type} value={type}>{type.replace(/\./g, " ")}</option>)}</select><Input aria-label="Audit history start date" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="h-9 border-white/[0.1] bg-black/20 text-[10px] text-slate-300" /><Input aria-label="Audit history end date" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="h-9 border-white/[0.1] bg-black/20 text-[10px] text-slate-300" /></div><div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/15">{auditQuery.isLoading ? <p className="px-4 py-8 text-center text-[10px] text-slate-600">Loading durable audit events…</p> : auditQuery.data?.length ? auditQuery.data.map(event => <div key={event.id} className="flex gap-3 border-b border-white/[0.05] px-4 py-3 last:border-0"><Clock3 className="mt-0.5 size-3.5 shrink-0 text-cyan-200/70" /><div className="min-w-0"><p className="text-[10px] font-medium text-slate-300">{event.detail}</p><p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-slate-600">{event.eventType.replace(/\./g, " ")} · {event.runnerId ? runners.find(runner => runner.id === event.runnerId)?.label ?? "Unknown device" : "Workspace"} · {formatTime(event.createdAt)}</p></div></div>) : <p className="px-4 py-8 text-center text-[10px] text-slate-600">No audit events match these filters.</p>}</div></div></section>;
}

function AuditHistoryExplorerBase({ runners, columns, setColumns }: { runners: any[]; columns: AuditExportColumn[]; setColumns: React.Dispatch<React.SetStateAction<AuditExportColumn[]>> }) {
  const [runnerId, setRunnerId] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [presetLabel, setPresetLabel] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("all");
  const utils = trpc.useUtils();
  const queryInput = useMemo(() => ({ ...(runnerId !== "all" ? { runnerId: Number(runnerId) } : {}), ...(eventType !== "all" ? { eventType } : {}), ...(startDate ? { startAt: new Date(`${startDate}T00:00:00`) } : {}), ...(endDate ? { endAt: new Date(`${endDate}T23:59:59.999`) } : {}) }), [runnerId, eventType, startDate, endDate]);
  const auditQuery = trpc.palm.localRunnerAudit.useQuery(queryInput, { refetchInterval: 10_000 });
  const presetsQuery = trpc.palm.localAuditFilterPresets.useQuery(undefined, { refetchInterval: 10_000 });
  const savePreset = trpc.palm.saveLocalAuditFilterPreset.useMutation({ onSuccess: () => { void utils.palm.localAuditFilterPresets.invalidate(); setPresetLabel(""); toast.success("Audit preset saved."); } });
  const deletePreset = trpc.palm.deleteLocalAuditFilterPreset.useMutation({ onSuccess: () => { void utils.palm.localAuditFilterPresets.invalidate(); setSelectedPresetId("all"); toast.success("Audit preset deleted."); } });
  const eventTypes = useMemo(() => Array.from(new Set(auditQuery.data?.map(event => event.eventType) ?? [])).sort(), [auditQuery.data]);
  const saveCurrentPreset = () => savePreset.mutate({ label: presetLabel.trim(), filters: { ...(runnerId !== "all" ? { runnerId: Number(runnerId) } : {}), ...(eventType !== "all" ? { eventType } : {}), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) } });
  const applyPreset = () => {
    const preset = presetsQuery.data?.find(item => String(item.id) === selectedPresetId);
    if (!preset) return;
    const filters = restoreAuditPresetFilters(preset.filterJson);
    setRunnerId(filters.runnerId); setEventType(filters.eventType); setStartDate(filters.startDate); setEndDate(filters.endDate);
  };
  const exportCsv = () => {
    const csv = serializeAuditCsv(auditQuery.data ?? [], new Map(runners.map(runner => [runner.id, runner.label])), columns);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `palm-audit-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };
  const toggleColumn = (column: AuditExportColumn, checked: boolean) => setColumns(current => {
    const selected = new Set(current);
    if (checked) selected.add(column);
    else if (current.length > 1) selected.delete(column);
    return AUDIT_EXPORT_COLUMNS.filter(item => selected.has(item));
  });
  return <section className="mx-auto max-w-3xl px-5 pb-12 sm:px-10"><div className="rounded-2xl border border-cyan-300/[0.12] bg-cyan-300/[0.02] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-cyan-300">Audit analysis</p><h3 className="mt-2 font-serif text-2xl tracking-[-0.04em] text-white">Make the evidence portable.</h3><p className="mt-2 max-w-xl text-[11px] leading-5 text-slate-500">Refine durable device evidence, save the view, and export only the fields you need.</p></div><Button onClick={exportCsv} disabled={!auditQuery.data?.length} className="h-9 rounded-lg bg-cyan-200 px-3 text-[10px] font-bold text-slate-950 hover:bg-cyan-100 disabled:bg-white/[0.08] disabled:text-slate-600"><Download className="mr-1.5 size-3.5" />Export CSV</Button></div><div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><select aria-label="Filter audit history by device" value={runnerId} onChange={event => setRunnerId(event.target.value)} className="h-9 rounded-lg border border-white/[0.1] bg-black/20 px-2 text-[10px] text-slate-300"><option value="all">All devices</option>{runners.map(runner => <option key={runner.id} value={runner.id}>{runner.label}</option>)}</select><select aria-label="Filter audit history by event type" value={eventType} onChange={event => setEventType(event.target.value)} className="h-9 rounded-lg border border-white/[0.1] bg-black/20 px-2 text-[10px] text-slate-300"><option value="all">All event types</option>{eventTypes.map(type => <option key={type} value={type}>{type.replace(/\./g, " ")}</option>)}</select><Input aria-label="Audit history start date" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="h-9 border-white/[0.1] bg-black/20 text-[10px] text-slate-300" /><Input aria-label="Audit history end date" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="h-9 border-white/[0.1] bg-black/20 text-[10px] text-slate-300" /></div><div className="mt-3 grid gap-2 rounded-xl border border-white/[0.06] bg-black/15 p-3 lg:grid-cols-[1fr_auto_auto]"><div className="flex gap-2"><select aria-label="Saved audit filter preset" value={selectedPresetId} onChange={event => setSelectedPresetId(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.1] bg-black/20 px-2 text-[10px] text-slate-300"><option value="all">Saved audit views</option>{presetsQuery.data?.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select><Button onClick={applyPreset} disabled={selectedPresetId === "all"} variant="ghost" className="h-8 border border-white/[0.1] px-2 text-[10px] text-cyan-100">Apply</Button><Button onClick={() => selectedPresetId !== "all" && deletePreset.mutate({ presetId: Number(selectedPresetId) })} disabled={selectedPresetId === "all" || deletePreset.isPending} variant="ghost" className="h-8 border border-white/[0.1] px-2 text-[10px] text-rose-200">Delete</Button></div><Input aria-label="Audit preset name" value={presetLabel} onChange={event => setPresetLabel(event.target.value)} placeholder="Name this view" className="h-8 border-white/[0.1] bg-black/20 text-[10px] text-slate-300" /><Button onClick={saveCurrentPreset} disabled={!presetLabel.trim() || savePreset.isPending} className="h-8 bg-violet-300 px-3 text-[10px] font-bold text-slate-950 hover:bg-violet-200">Save preset</Button></div><div className="mt-3 rounded-xl border border-white/[0.06] bg-black/15 p-3"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">CSV columns</p><div className="mt-2 flex flex-wrap gap-2">{AUDIT_EXPORT_COLUMNS.map(column => <label key={column} className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5 text-[9px] text-slate-400"><input type="checkbox" checked={columns.includes(column)} onChange={event => toggleColumn(column, event.target.checked)} className="accent-cyan-300" />{column.replace(/_/g, " ")}</label>)}</div></div><div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/15">{auditQuery.isLoading ? <p className="px-4 py-8 text-center text-[10px] text-slate-600">Loading audit events…</p> : auditQuery.data?.length ? auditQuery.data.map(event => <div key={event.id} className="flex gap-3 border-b border-white/[0.05] px-4 py-3 last:border-0"><Clock3 className="mt-0.5 size-3.5 shrink-0 text-cyan-200/70" /><div className="min-w-0"><p className="text-[10px] font-medium text-slate-300">{event.detail}</p><p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-slate-600">{event.eventType.replace(/\./g, " ")} · {formatTime(event.createdAt)}</p></div></div>) : <p className="px-4 py-8 text-center text-[10px] text-slate-600">No audit events match these filters.</p>}</div></div></section>;
}

function DeviceAuditExportTemplateManager({ runners, columns, setColumns }: { runners: any[]; columns: AuditExportColumn[]; setColumns: React.Dispatch<React.SetStateAction<AuditExportColumn[]>> }) {
  const [runnerId, setRunnerId] = useState("");
  const [label, setLabel] = useState("");
  const [templateId, setTemplateId] = useState("all");
  const utils = trpc.useUtils();
  useEffect(() => { if (!runnerId && runners.length) setRunnerId(String(runners[0].id)); }, [runnerId, runners]);
  const templatesQuery = trpc.palm.localAuditExportTemplates.useQuery(undefined, { refetchInterval: 10_000 });
  const saveTemplate = trpc.palm.saveLocalAuditExportTemplate.useMutation({ onSuccess: () => { void utils.palm.localAuditExportTemplates.invalidate(); setLabel(""); toast.success("Device CSV template saved."); } });
  const deleteTemplate = trpc.palm.deleteLocalAuditExportTemplate.useMutation({ onSuccess: () => { void utils.palm.localAuditExportTemplates.invalidate(); setTemplateId("all"); toast.success("Device CSV template deleted."); } });
  const deviceTemplates = useMemo(() => (templatesQuery.data ?? []).filter(template => String(template.runnerId) === runnerId), [templatesQuery.data, runnerId]);
  const selectedRunner = runners.find(runner => String(runner.id) === runnerId);
  const applyTemplate = () => { const restored = applyDeviceAuditExportTemplate(deviceTemplates, Number(runnerId), Number(templateId)); if (restored) setColumns(restored); };
  const toggleColumn = (column: AuditExportColumn, checked: boolean) => setColumns(current => { const selected = new Set(current); if (checked) selected.add(column); else if (current.length > 1) selected.delete(column); return AUDIT_EXPORT_COLUMNS.filter(item => selected.has(item)); });
  if (!runners.length) return null;
  return <section className="mx-auto max-w-3xl px-5 pb-12 sm:px-10"><div className="rounded-2xl border border-emerald-300/[0.13] bg-emerald-300/[0.025] p-5"><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-200">Device CSV templates</p><h3 className="mt-2 font-serif text-2xl tracking-[-0.04em] text-white">Carry the right evidence fields per machine.</h3><p className="mt-2 max-w-2xl text-[11px] leading-5 text-slate-500">Save a reusable CSV field selection for each registered Local Runner. Applying a template restores its columns without changing your current audit filters.</p><div className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto]"><select aria-label="Device for CSV export template" value={runnerId} onChange={event => { setRunnerId(event.target.value); setTemplateId("all"); }} className="h-9 rounded-lg border border-white/[0.1] bg-black/20 px-2.5 text-[10px] text-slate-300">{runners.map(runner => <option key={runner.id} value={runner.id}>{runner.label}</option>)}</select><div className="flex items-center rounded-lg bg-emerald-300/[0.06] px-3 text-[10px] text-emerald-100">{selectedRunner?.connectionStatus ?? "offline"}</div></div><div className="mt-3 rounded-xl border border-white/[0.06] bg-black/15 p-3"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">Template columns</p><div className="mt-2 flex flex-wrap gap-2">{AUDIT_EXPORT_COLUMNS.map(column => <label key={column} className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5 text-[9px] text-slate-400"><input type="checkbox" checked={columns.includes(column)} onChange={event => toggleColumn(column, event.target.checked)} className="accent-emerald-300" />{column.replace(/_/g, " ")}</label>)}</div></div><div className="mt-3 grid gap-2 rounded-xl border border-white/[0.06] bg-black/15 p-3 lg:grid-cols-[1fr_auto_auto]"><div className="flex gap-2"><select aria-label="Saved device CSV template" value={templateId} onChange={event => setTemplateId(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.1] bg-black/20 px-2 text-[10px] text-slate-300"><option value="all">Saved templates for this device</option>{deviceTemplates.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}</select><Button onClick={applyTemplate} disabled={templateId === "all"} variant="ghost" className="h-8 border border-white/[0.1] px-2 text-[10px] text-emerald-100">Apply</Button><Button onClick={() => templateId !== "all" && deleteTemplate.mutate({ templateId: Number(templateId) })} disabled={templateId === "all" || deleteTemplate.isPending} variant="ghost" className="h-8 border border-white/[0.1] px-2 text-[10px] text-rose-200">Delete</Button></div><Input aria-label="Device CSV template name" value={label} onChange={event => setLabel(event.target.value)} placeholder="Name this field set" className="h-8 border-white/[0.1] bg-black/20 text-[10px] text-slate-300" /><Button onClick={() => runnerId && label.trim() && saveTemplate.mutate({ runnerId: Number(runnerId), label: label.trim(), columns })} disabled={!runnerId || !label.trim() || saveTemplate.isPending} className="h-8 bg-emerald-300 px-3 text-[10px] font-bold text-slate-950 hover:bg-emerald-200">Save template</Button></div></div></section>;
}

function AuditHistoryExplorer({ runners }: { runners: any[] }) {
  const [columns, setColumns] = useState<AuditExportColumn[]>([...AUDIT_EXPORT_COLUMNS]);
  return <><AuditHistoryExplorerBase runners={runners} columns={columns} setColumns={setColumns} /><DeviceAuditExportTemplateManager runners={runners} columns={columns} setColumns={setColumns} /></>;
}

function RunnerScopeCard({ runner, onSave, isSaving }: { runner: any; onSave: (runnerId: number, allowedTools: string[], requiresApprovalForSensitive: boolean, allowedSkillSlugs?: string[], allowedSensitiveActions?: string[], allowedBrowserTools?: string[], navigationAllowlist?: string[], requiresApprovalForBrowserWrites?: boolean) => void; isSaving: boolean }) {
  const parsedTools = useMemo(() => { try { return JSON.parse(runner.allowedToolsJson) as string[]; } catch { return Object.keys(runnerToolLabels); } }, [runner.allowedToolsJson]);
  const parsedBrowserTools = useMemo(() => { try { return JSON.parse(runner.allowedBrowserToolsJson) as string[]; } catch { return ["open_tab", "navigate", "screenshot", "read_page_text", "close_tab"]; } }, [runner.allowedBrowserToolsJson]);
  const isBrowserRunner = runner.runnerType === "browser";
  const [tools, setTools] = useState<string[]>(isBrowserRunner ? parsedBrowserTools : parsedTools);
  const [requiresApproval, setRequiresApproval] = useState(Boolean(runner.requiresApprovalForSensitive));
  const [requiresBrowserApproval, setRequiresBrowserApproval] = useState(runner.requiresApprovalForBrowserWrites !== false);
  const [domainList, setDomainList] = useState(() => { try { return (JSON.parse(runner.navigationAllowlistJson) as string[]).join(", "); } catch { return ""; } });
  useEffect(() => { setTools(isBrowserRunner ? parsedBrowserTools : parsedTools); setRequiresApproval(Boolean(runner.requiresApprovalForSensitive)); setRequiresBrowserApproval(runner.requiresApprovalForBrowserWrites !== false); try { setDomainList((JSON.parse(runner.navigationAllowlistJson) as string[]).join(", ")); } catch { setDomainList(""); } }, [isBrowserRunner, parsedBrowserTools, parsedTools, runner.navigationAllowlistJson, runner.requiresApprovalForBrowserWrites, runner.requiresApprovalForSensitive]);
  const statusClass = runner.connectionStatus === "online" ? "bg-emerald-300" : runner.connectionStatus === "revoked" ? "bg-rose-300" : "bg-slate-600";
  const selectedLabels = isBrowserRunner ? browserToolLabels : runnerToolLabels;
  return <div className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><span className={cn("size-2 rounded-full", statusClass)} /><div><p className="truncate text-[12px] font-semibold text-slate-100">{runner.label}</p><p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-slate-600">{isBrowserRunner ? "browser runner · " : "file runner · "}{runner.connectionStatus}{runner.lastSeenAt ? ` · seen ${formatTime(runner.lastSeenAt)}` : ""}</p></div></div><span className="rounded-md bg-white/[0.045] px-2 py-1 text-[9px] text-slate-500">{tools.length} tools</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{Object.entries(selectedLabels).map(([tool, label]) => <label key={tool} className="flex cursor-pointer items-center gap-2 rounded-lg bg-black/15 px-2.5 py-2 text-[10px] text-slate-400"><input type="checkbox" checked={tools.includes(tool)} disabled={runner.connectionStatus === "revoked"} onChange={event => setTools(current => event.target.checked ? [...current, tool] : current.filter(value => value !== tool))} className="accent-violet-300" />{label}</label>)}</div>{isBrowserRunner && <div className="mt-3 rounded-xl border border-cyan-300/[0.1] bg-cyan-300/[0.025] p-3"><label className="block text-[10px] font-medium text-cyan-100">Read-only navigation allowlist</label><Input value={domainList} onChange={event => setDomainList(event.target.value)} disabled={runner.connectionStatus === "revoked"} placeholder="example.com, docs.example.com" className="mt-2 h-8 border-cyan-300/15 bg-black/15 text-[10px] text-slate-100 placeholder:text-slate-700" /><p className="mt-2 text-[9px] leading-4 text-slate-600">Navigations outside these domains request approval. Browser write tools request approval by default.</p></div>}<div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3"><label className="flex items-center gap-2 text-[10px] text-slate-400"><Switch checked={isBrowserRunner ? requiresBrowserApproval : requiresApproval} onCheckedChange={isBrowserRunner ? setRequiresBrowserApproval : setRequiresApproval} disabled={runner.connectionStatus === "revoked"} />Require approval for {isBrowserRunner ? "browser writes" : "sensitive actions"}</label><Button onClick={() => onSave(runner.id, isBrowserRunner ? (JSON.parse(runner.allowedToolsJson || "[]") as string[]) : tools, requiresApproval, undefined, undefined, isBrowserRunner ? tools : undefined, isBrowserRunner ? domainList.split(",").map(value => value.trim().toLowerCase()).filter(Boolean) : undefined, isBrowserRunner ? requiresBrowserApproval : undefined)} disabled={isSaving || runner.connectionStatus === "revoked" || (!isBrowserRunner && !tools.includes("write_result_record")) || (isBrowserRunner && !tools.some(tool => ["open_tab", "navigate", "screenshot", "read_page_text", "close_tab"].includes(tool)))} className="h-8 rounded-lg bg-violet-300 px-3 text-[10px] font-bold text-slate-950 hover:bg-violet-200 disabled:bg-white/[0.08] disabled:text-slate-600">Save device scope</Button></div></div>;
}

function DeviceTimeoutOverrides({ runners, defaultMinutes, onSave, isSaving }: { runners: any[]; defaultMinutes: number; onSave: (runnerId: number, expiryMinutes: number | null) => void; isSaving: boolean }) {
  if (!runners.length) return null;
  return <section className="mx-auto max-w-3xl px-5 pb-12 sm:px-10"><div className="rounded-2xl border border-amber-300/[0.14] bg-amber-300/[0.025] p-5"><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-amber-200">Device approval timing</p><h3 className="mt-2 font-serif text-2xl tracking-[-0.04em] text-white">Set a distinct decision window per device.</h3><p className="mt-2 max-w-2xl text-[11px] leading-5 text-slate-500">An override applies only when Palm queues a sensitive task for that Local Runner. Clearing it returns the device to the workspace default of {defaultMinutes} minutes.</p><div className="mt-5 grid gap-3 lg:grid-cols-2">{runners.map(runner => <DeviceTimeoutOverrideCard key={runner.id} runner={runner} defaultMinutes={defaultMinutes} onSave={onSave} isSaving={isSaving} />)}</div></div></section>;
}

function DeviceTimeoutOverrideCard({ runner, defaultMinutes, onSave, isSaving }: { runner: any; defaultMinutes: number; onSave: (runnerId: number, expiryMinutes: number | null) => void; isSaving: boolean }) {
  const [value, setValue] = useState(runner.approvalExpiryOverrideMinutes ? String(runner.approvalExpiryOverrideMinutes) : "");
  useEffect(() => setValue(runner.approvalExpiryOverrideMinutes ? String(runner.approvalExpiryOverrideMinutes) : ""), [runner.approvalExpiryOverrideMinutes]);
  const disabled = runner.connectionStatus === "revoked";
  const parsed = Number(value);
  const valid = !value || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 1440);
  return <div className="rounded-xl border border-white/[0.07] bg-black/15 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold text-slate-200">{runner.label}</p><p className="mt-1 text-[9px] uppercase tracking-[0.12em] text-slate-600">{runner.approvalExpiryOverrideMinutes ? `${runner.approvalExpiryOverrideMinutes} minute override` : `Using ${defaultMinutes} minute default`}</p></div><span className={cn("size-2 rounded-full", runner.connectionStatus === "online" ? "bg-emerald-300" : runner.connectionStatus === "revoked" ? "bg-rose-300" : "bg-slate-600")} /></div><div className="mt-4 flex items-center gap-2"><Input aria-label={`${runner.label} approval timeout override`} type="number" min="1" max="1440" placeholder={`${defaultMinutes}`} value={value} disabled={disabled} onChange={event => setValue(event.target.value)} className="h-8 w-20 border-amber-300/20 bg-black/15 text-[11px] text-amber-50" /><span className="text-[10px] text-amber-100/60">minutes</span><Button onClick={() => value && valid && onSave(runner.id, parsed)} disabled={disabled || isSaving || !value || !valid} className="ml-auto h-8 rounded-lg bg-amber-200 px-3 text-[10px] font-bold text-slate-950 hover:bg-amber-100 disabled:bg-white/[0.08] disabled:text-slate-600">Save</Button></div><button onClick={() => onSave(runner.id, null)} disabled={disabled || isSaving || !runner.approvalExpiryOverrideMinutes} className="mt-3 text-[10px] text-slate-500 hover:text-amber-100 disabled:opacity-40">Use workspace default</button></div>;
}

function DeviceCapabilityScopes({ runners, onUpdateRunnerScope, isSaving }: { runners: any[]; onUpdateRunnerScope: (runnerId: number, allowedTools: string[], requiresApprovalForSensitive: boolean, allowedSkillSlugs?: string[], allowedSensitiveActions?: string[], allowedBrowserTools?: string[], navigationAllowlist?: string[], requiresApprovalForBrowserWrites?: boolean) => void; isSaving: boolean }) {
  if (!runners.length) return null;
  return <section className="mx-auto max-w-3xl px-5 pb-12 sm:px-10"><div className="rounded-2xl border border-violet-300/[0.12] bg-violet-300/[0.025] p-5"><div><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-violet-300">Palm capability scope</p><h3 className="mt-2 font-serif text-2xl tracking-[-0.04em] text-white">Plan only with what this device may receive.</h3><p className="mt-2 max-w-2xl text-[11px] leading-5 text-slate-500">Palm intersects your workspace capability preferences with each device’s permitted capability set before a Local Runner receives its task payload.</p></div><div className="mt-5 grid gap-3 lg:grid-cols-2">{runners.map(runner => <DeviceCapabilityScopeCard key={runner.id} runner={runner} onSave={onUpdateRunnerScope} isSaving={isSaving} />)}</div></div></section>;
}

function DeviceCapabilityScopeCard({ runner, onSave, isSaving }: { runner: any; onSave: (runnerId: number, allowedTools: string[], requiresApprovalForSensitive: boolean, allowedSkillSlugs?: string[], allowedSensitiveActions?: string[], allowedBrowserTools?: string[], navigationAllowlist?: string[], requiresApprovalForBrowserWrites?: boolean) => void; isSaving: boolean }) {
  const parsedSkills = useMemo(() => { try { return JSON.parse(runner.allowedSkillSlugsJson) as string[]; } catch { return Object.keys(runnerSkillLabels); } }, [runner.allowedSkillSlugsJson]);
  const [skills, setSkills] = useState<string[]>(parsedSkills);
  useEffect(() => setSkills(parsedSkills), [parsedSkills]);
  const parsedActions = useMemo(() => { try { return JSON.parse(runner.allowedSensitiveActionsJson) as string[]; } catch { return Object.keys(runnerActionLabels); } }, [runner.allowedSensitiveActionsJson]);
  const [actions, setActions] = useState<string[]>(parsedActions);
  useEffect(() => setActions(parsedActions), [parsedActions]);
  const tools = useMemo(() => { try { return JSON.parse(runner.allowedToolsJson) as string[]; } catch { return Object.keys(runnerToolLabels); } }, [runner.allowedToolsJson]);
  const disabled = runner.connectionStatus === "revoked";
  return <div className="rounded-xl border border-white/[0.07] bg-black/15 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold text-slate-200">{runner.label}</p><p className="mt-1 text-[9px] uppercase tracking-[0.12em] text-slate-600">{skills.length} capabilities · {actions.length} action classes</p></div><span className={cn("size-2 rounded-full", runner.connectionStatus === "online" ? "bg-emerald-300" : runner.connectionStatus === "revoked" ? "bg-rose-300" : "bg-slate-600")} /></div><p className="mt-3 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">Palm capabilities</p><div className="mt-2 grid grid-cols-2 gap-2">{Object.entries(runnerSkillLabels).map(([slug, label]) => <label key={slug} className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/[0.025] px-2 py-2 text-[10px] text-slate-400"><input type="checkbox" checked={skills.includes(slug)} disabled={disabled} onChange={event => setSkills(current => event.target.checked ? [...current, slug] : current.filter(item => item !== slug))} className="accent-violet-300" />{label}</label>)}</div><p className="mt-3 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">Sensitive action classes</p><div className="mt-2 grid grid-cols-3 gap-2">{Object.entries(runnerActionLabels).map(([action, label]) => <label key={action} className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/[0.025] px-2 py-2 text-[9px] text-slate-400"><input type="checkbox" checked={actions.includes(action)} disabled={disabled} onChange={event => setActions(current => event.target.checked ? [...current, action] : current.filter(item => item !== action))} className="accent-violet-300" />{label}</label>)}</div><div className="mt-3 flex justify-end"><Button onClick={() => onSave(runner.id, tools, Boolean(runner.requiresApprovalForSensitive), skills, actions)} disabled={disabled || isSaving} className="h-8 rounded-lg bg-violet-300 px-3 text-[10px] font-bold text-slate-950 hover:bg-violet-200 disabled:bg-white/[0.08] disabled:text-slate-600">Save device boundary</Button></div></div>;
}

function LocalApprovalCard({ policyJson, expiresAt, onDecision, isDeciding }: { policyJson: string; expiresAt?: Date | string; onDecision: (decision: "approved" | "rejected") => void; isDeciding: boolean }) {
  let policy: any = {};
  try { policy = JSON.parse(policyJson); } catch { /* use safe fallback */ }
  return <div className="mt-8 rounded-2xl border border-amber-300/20 bg-amber-300/[0.055] p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-4 text-amber-200" /><div><p className="text-[13px] font-semibold text-amber-50">Approval required for a sensitive local action</p><p className="mt-1 text-[11px] leading-5 text-amber-100/60">{policy.approvalReason || "This task needs an explicit local-action decision before Palm releases it to your device."}</p><p className="mt-3 text-[10px] text-slate-500">Allowed file tools: {(policy.allowedTools || []).join(", ") || "none"}</p>{expiresAt && <p className="mt-1 text-[10px] text-amber-100/70">Expires {new Date(expiresAt).toLocaleString()}</p>}<div className="mt-4 flex gap-2"><Button onClick={() => onDecision("approved")} disabled={isDeciding} className="h-8 bg-amber-200 px-3 text-[10px] font-bold text-slate-950 hover:bg-amber-100">Approve local action</Button><Button onClick={() => onDecision("rejected")} disabled={isDeciding} variant="ghost" className="h-8 border border-amber-200/20 px-3 text-[10px] text-amber-100 hover:bg-amber-200/10">Reject</Button></div></div></div></div>;
}

function ContextPanel({ view, skillsEnabled }: { view: View; skillsEnabled: number }) {
  const title = view === "skills" ? "Capability context" : view === "dashboard" ? "Overview context" : "Workspace context";
  return <div><div className="rounded-2xl border border-white/[0.075] bg-white/[0.025] p-4"><p className="text-[12px] font-semibold text-slate-200">{title}</p><p className="mt-2 text-[10px] leading-5 text-slate-600">Return to the workspace to inspect a task’s observable execution trace.</p></div><div className="mt-6"><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">Workspace signals</p><div className="space-y-3"><div className="flex items-center justify-between text-[11px]"><span className="text-slate-500">Enabled capabilities</span><span className="font-semibold text-slate-300">{skillsEnabled}</span></div><div className="flex items-center justify-between text-[11px]"><span className="text-slate-500">Task history</span><span className="font-semibold text-slate-300">Persistent</span></div><div className="flex items-center justify-between text-[11px]"><span className="text-slate-500">Result export</span><span className="font-semibold text-slate-300">Available</span></div></div></div></div>;
}

function SignedOutPanel({ icon: Icon, title, body }: { icon: typeof Sparkles; title: string; body: string }) {
  return <div className="mx-auto flex min-h-[calc(100vh-78px)] max-w-xl flex-col justify-center px-5 py-12 sm:px-10"><div className="grid size-11 place-items-center rounded-2xl border border-violet-300/15 bg-violet-400/[0.08] text-violet-200"><Icon className="size-5" /></div><h1 className="mt-6 font-serif text-4xl tracking-[-0.05em] text-white">{title}</h1><p className="mt-4 max-w-md text-[13px] leading-6 text-slate-500">{body}</p><Button onClick={startLogin} className="mt-7 h-10 w-fit gap-2 rounded-xl bg-violet-300 px-4 text-[12px] font-bold text-slate-950 hover:bg-violet-200"><ShieldCheck className="size-4" /> Sign in to continue</Button></div>;
}
