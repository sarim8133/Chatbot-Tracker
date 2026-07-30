// Role → what the UI shows. ONE map, mirroring the private.* capability
// functions in db/roles-and-approvals.sql.
//
// ⚠️  THIS IS COSMETIC. Not one of these booleans is a security boundary. The
// database refuses the same things via RLS and a SECURITY DEFINER guard in every
// RPC, and it refuses them to a crafted REST call that never loads this file.
// What this map buys is a UI that doesn't offer a button the server will reject.
// If it ever disagrees with the SQL, the SQL is right.
//
// `setLimits` is separate from `manage` on purpose. The finance manager approves
// spend, so they must be able to set the caps that decide what needs approving —
// but `manage` also carries split and delete, and a manager has no business
// destroying receipts. finance_viewer gets neither: a records-keeper must not be
// able to change the numbers they keep records of, least of all their own cap.
//
// `chats` is READING the transcript (Conversations / Reps / Overview).
// `chat`  is having the Chat TAB. True for everyone, and not because the sales
//         bot is useful to Finance — the web receipt uploader lives inside the
//         chat composer, so this flag also decides whether a person can file
//         their own expenses from the website. It stays in the map rather than
//         being hardcoded so it can be withdrawn the day uploading gets its own
//         screen.

export const CAPS = {
  dev: {
    label: 'Developer', tone: 'accent',
    chats: true, cache: true, team: true, chat: true,
    allExpenses: true, approvedExpenses: true,
    manage: true, approve: true, approveOverLimit: true, setLimits: true,
  },
  ceo: {
    label: 'CEO', tone: 'accent',
    chats: true, cache: false, team: false, chat: true,
    allExpenses: true, approvedExpenses: true,
    manage: false, approve: false, approveOverLimit: false, setLimits: false,
  },
  finance_manager: {
    label: 'Finance Manager', tone: 'pos',
    chats: false, cache: false, team: false, chat: true,
    allExpenses: true, approvedExpenses: true,
    manage: false, approve: true, approveOverLimit: true, setLimits: true,
  },
  finance_admin: {
    label: 'Finance Admin', tone: 'pos',
    chats: false, cache: false, team: false, chat: true,
    allExpenses: true, approvedExpenses: true,
    manage: true, approve: true, approveOverLimit: false, setLimits: true,
  },
  finance_viewer: {
    label: 'Finance', tone: 'pos',
    chats: false, cache: false, team: false, chat: true,
    allExpenses: false, approvedExpenses: true,
    manage: false, approve: false, approveOverLimit: false, setLimits: false,
  },
  employee: {
    label: 'Employee', tone: 'muted',
    chats: false, cache: false, team: false, chat: true,
    allExpenses: false, approvedExpenses: false,
    manage: false, approve: false, approveOverLimit: false, setLimits: false,
  },
};

// An unknown or not-yet-loaded role gets the most restrictive answer, never an
// elevated one — the same fail-closed rule as useProfile's 'employee' fallback.
// This is what stops a stale localStorage role (say the pre-2026-07-30 'admin')
// from rendering a nav it is no longer entitled to.
export const capsFor = role => CAPS[role] || CAPS.employee;

// The Team tab's role picker. Order is deliberate: most privileged first, so the
// dangerous option is never the one you land on by accident.
export const ROLE_CHOICES = [
  { value: 'dev',             label: 'Developer',         desc: 'Everything — all tabs, all data, manages the team' },
  { value: 'ceo',             label: 'CEO',               desc: 'All analytics + every expense, read-only. No Cache, no Team' },
  { value: 'finance_manager', label: 'Finance Manager',   desc: 'Approves expenses (including over-limit) and sets spending limits' },
  { value: 'finance_admin',   label: 'Finance Admin',     desc: 'Reviews & manages expenses, sets limits, flags, remarks' },
  { value: 'finance_viewer',  label: 'Finance (records)', desc: 'Read-only view of approved expenses — cannot change limits' },
  { value: 'employee',        label: 'Employee',          desc: 'Chatbot + only their own expenses' },
];
