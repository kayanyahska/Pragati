import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useNavigate, Navigate } from 'react-router-dom';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, collection, onSnapshot, updateDoc, deleteDoc, addDoc, serverTimestamp, query, orderBy, setDoc, writeBatch } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';

// --- CONFIGURATION AND UTILITIES ---
const appId = 'default-app-id';
const firebaseConfig = {
  
};

let app, db, auth;

const STATUSES = ['To Do', 'In Progress', 'Done'];
const PRIORITY_STYLES = {
  High:   { dot: 'bg-red-500', badge: 'bg-red-100 text-red-800' },
  Medium: { dot: 'bg-yellow-500', badge: 'bg-yellow-100 text-yellow-800' },
  Low:    { dot: 'bg-green-500', badge: 'bg-green-100 text-green-800' },
};

// --- HELPER FUNCTIONS ---
const getTaskCollectionPath = (userId, viewMode, groupId) => { if (!userId) return null; if (viewMode === 'private') { return `artifacts/${appId}/users/${userId}/tasks`; } if (viewMode === 'group' && groupId.trim()) { return `artifacts/${appId}/public/data/groups/${groupId.trim()}/tasks`; } return null; };
const getCommentCollectionPath = (userId, viewMode, groupId, taskId) => { if (!taskId) return null; const taskPath = getTaskCollectionPath(userId, viewMode, groupId); return taskPath ? `${taskPath}/${taskId}/comments` : null; };

// ✨ NEW: This function now performs the database writes directly
const joinGroupSecurely = async (groupId, user) => {
    if (!groupId || !user || !user.uid || !user.email) {
        throw new Error("Invalid user or group ID provided.");
    }
    const batch = writeBatch(db);
    // Add group to user's private list
    const userGroupRef = doc(db, `users/${user.uid}/groups`, groupId);
    batch.set(userGroupRef, { id: groupId, role: "member", joinedAt: serverTimestamp() });
    // Add user to the group's public member list
    const memberRef = doc(db, `artifacts/${appId}/public/data/groups/${groupId}/members`, user.uid);
    batch.set(memberRef, { email: user.email, role: "member" });
    await batch.commit();
};

// --- UI COMPONENTS ---

const CommentsSection = ({ userId, currentUserEmail, taskId, viewMode, groupId }) => {
    const [comments, setComments] = useState([]); const [newComment, setNewComment] = useState('');
    const commentCollectionPath = getCommentCollectionPath(userId, viewMode, groupId, taskId);
    useEffect(() => { if (!db || !commentCollectionPath) return; const q = query(collection(db, commentCollectionPath), orderBy('createdAt', 'asc')); const unsub = onSnapshot(q, (snapshot) => setComments(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))); return () => unsub(); }, [commentCollectionPath]);
    const handleAddComment = async (e) => { e.preventDefault(); if (!db || !commentCollectionPath || !newComment.trim()) return; try { await addDoc(collection(db, commentCollectionPath), { text: newComment.trim(), createdBy: currentUserEmail || `User ${userId.substring(0, 8)}`, createdAt: serverTimestamp() }); setNewComment(''); } catch (err) { console.error("Error adding comment:", err); } };
    const formatDate = (ts) => ts ? new Date(ts.seconds * 1000).toLocaleString() : 'Just now';
    return <div className="mt-6 bg-gray-50 p-4 rounded-lg border border-gray-200"><h3 className="text-lg font-semibold text-gray-800 mb-4">Comments ({comments.length})</h3><div className="space-y-3 max-h-60 overflow-y-auto pr-2 mb-4">{comments.length === 0 ? <p className="text-sm text-gray-500 text-center py-4">Be the first to leave a comment.</p> : comments.map(c => <div key={c.id} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm"><div className="flex justify-between items-center text-xs mb-1"><span className="font-semibold text-blue-700">{c.createdBy}</span><span className="text-gray-500">{formatDate(c.createdAt)}</span></div><p className="text-sm text-gray-700 whitespace-pre-wrap">{c.text}</p></div>)}</div><form onSubmit={handleAddComment} className="flex space-x-2"><textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} rows="2" className="flex-grow p-2 border bg-white border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none text-sm text-gray-800 placeholder-gray-400" placeholder="Write a comment..." /><button type="submit" disabled={!newComment.trim()} className="self-end px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-blue-700 transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed">Post</button></form></div>
};

const TaskCard = ({ task, onEdit, onDelete, onDragStart, onDragEnd }) => {
    const priorityStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.Medium;
    return <motion.div layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 300, damping: 25 }} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md hover:ring-2 hover:ring-blue-500 transition-all duration-200 flex flex-col cursor-grab active:cursor-grabbing" draggable="true" onDragStart={(e) => onDragStart(e, task.id, task.status)} onDragEnd={onDragEnd}><div className="flex items-start gap-3"><span className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${priorityStyle.dot}`}></span><div className="flex-grow"><h3 className="text-base font-semibold text-gray-800 break-words">{task.title}</h3><p className="text-sm text-gray-500 break-words line-clamp-2 mt-1">{task.description || 'No description provided.'}</p></div></div><div className="flex justify-between items-center text-xs mt-4 pt-3 border-t border-gray-100"><p className="text-gray-500">Assignee: <span className="font-medium text-gray-700">{task.assignee || 'Unassigned'}</span></p><div className="flex items-center space-x-1"><span className={`px-2 py-0.5 font-semibold rounded-md text-xs ${priorityStyle.badge}`}>{task.priority}</span><button onClick={() => onEdit(task)} className="text-gray-400 hover:text-blue-600 p-1.5 rounded-full hover:bg-gray-100 transition" title="Edit Task"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L14.732 3.732z" /></svg></button><button onClick={() => onDelete(task.id)} className="text-gray-400 hover:text-red-600 p-1.5 rounded-full hover:bg-gray-100 transition" title="Delete Task"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button></div></div></motion.div>
};

const TaskModal = ({ isOpen, onClose, onSubmit, initialTask, ...props }) => {
    const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [status, setStatus] = useState(STATUSES[0]); const [priority, setPriority] = useState('Medium'); const [assignee, setAssignee] = useState('');
    useEffect(() => { if (initialTask) { setTitle(initialTask.title || ''); setDescription(initialTask.description || ''); setStatus(initialTask.status || STATUSES[0]); setPriority(initialTask.priority || 'Medium'); setAssignee(initialTask.assignee || ''); } else { setTitle(''); setDescription(''); setStatus(STATUSES[0]); setPriority('Medium'); setAssignee(''); } }, [initialTask, isOpen]);
    const handleSubmit = (e) => { e.preventDefault(); if (!title.trim()) return; onSubmit({ title: title.trim(), description: description.trim(), priority, assignee: assignee.trim(), status }, initialTask ? initialTask.id : null); if (!initialTask) onClose(); };
    const handleQuickStatusUpdate = (newStatus) => { setStatus(newStatus); if (initialTask) { onSubmit({ status: newStatus }, initialTask.id); onClose(); } };
    return <AnimatePresence>{isOpen && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto"><motion.div initial={{ y: 50, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 50, scale: 0.95 }} className="bg-white rounded-2xl w-full max-w-2xl shadow-xl my-8"><div className="p-8"><div className="flex justify-between items-start mb-6 pb-4 border-b border-gray-200"><h2 className="text-2xl font-bold text-gray-800">{!!initialTask ? 'Task Details' : 'Create New Task'}</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100 transition"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button></div><form onSubmit={handleSubmit} className="space-y-5"><div><label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">Title</label><input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required className="w-full p-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900" placeholder="e.g., Design new homepage mockup" /></div><div><label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows="4" className="w-full p-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y text-gray-800" placeholder="Add more details..." /></div><div className="grid grid-cols-1 md:grid-cols-3 gap-4"><div><label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">Status</label><select id="status" value={status} onChange={(e) => handleQuickStatusUpdate(e.target.value)} className="w-full p-2.5 border bg-white border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-800">{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></div><div><label htmlFor="priority" className="block text-sm font-medium text-gray-700 mb-1">Priority</label><select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full p-2.5 border bg-white border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-800">{['High', 'Medium', 'Low'].map(p => <option key={p} value={p}>{p}</option>)}</select></div><div><label htmlFor="assignee" className="block text-sm font-medium text-gray-700 mb-1">Assignee</label><input id="assignee" type="text" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900" placeholder="e.g., Jane Doe" /></div></div><div className="flex justify-end space-x-3 pt-4"><button type="button" onClick={onClose} className="px-5 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition">{!!initialTask ? 'Close' : 'Cancel'}</button><button type="submit" className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 transition disabled:opacity-50" disabled={!title.trim()}>{!!initialTask ? 'Save Changes' : 'Create Task'}</button></div></form>{!!initialTask && <CommentsSection {...props} initialTask={initialTask} />}</div></motion.div></motion.div>}</AnimatePresence>
};

const AuthScreen = ({ onLogin, onSignup, loading, error }) => {
    const [isLoginView, setIsLoginView] = useState(true); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
    const handleSubmit = (e) => { e.preventDefault(); if (isLoginView) onLogin(email, password); else onSignup(email, password); };
    return <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4 animated-bg"><motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-gray-200"><h2 className="text-3xl font-bold text-center text-gray-800 mb-2">{isLoginView ? 'Welcome Back!' : 'Create an Account'}</h2><p className="text-center text-gray-500 mb-8">Enter your credentials to get started.</p><form onSubmit={handleSubmit} className="space-y-4"><div><label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition" placeholder="you@example.com" /></div><div><label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label><input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition" placeholder="••••••••" /></div>{error && <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 rounded-md text-sm" role="alert"><p>{error}</p></div>}<button type="submit" disabled={loading} className="w-full py-3 bg-blue-600 text-white text-base font-semibold rounded-lg shadow-sm hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center">{loading ? <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : isLoginView ? 'Log In' : 'Sign Up'}</button></form><button onClick={() => setIsLoginView(!isLoginView)} className="mt-6 w-full text-center text-sm text-blue-600 hover:underline transition">{isLoginView ? "Don't have an account? Sign Up" : 'Already have an account? Log In'}</button></motion.div></div>
};

const CreateGroupModal = ({ isOpen, onClose, onCreate }) => {
    const [groupName, setGroupName] = useState(''); const [inviteEmails, setInviteEmails] = useState('');
    const handleSubmit = (e) => { e.preventDefault(); onCreate(groupName, inviteEmails); setGroupName(''); setInviteEmails(''); };
    return <AnimatePresence>{isOpen && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"><motion.div initial={{ y: 50, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 50, scale: 0.95 }} className="bg-white rounded-2xl w-full max-w-md shadow-xl"><form onSubmit={handleSubmit} className="p-6"><div className="flex justify-between items-start mb-4"><h2 className="text-xl font-bold text-gray-800">Create New Workspace</h2><button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100 transition"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button></div><div className="space-y-4"><div><label htmlFor="group-name" className="block text-sm font-medium text-gray-700 mb-1">Workspace Name</label><input id="group-name" type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} required className="w-full p-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="e.g., Marketing Team"/></div><div><label htmlFor="invite-emails-create" className="block text-sm font-medium text-gray-700 mb-1">Invite Members (Optional)</label><input id="invite-emails-create" type="text" value={inviteEmails} onChange={(e) => setInviteEmails(e.target.value)} placeholder="email1@example.com, email2@example.com" className="w-full p-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" /><p className="text-xs text-gray-500 mt-1">Separate multiple emails with a comma.</p></div></div><div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200"><button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition">Cancel</button><button type="submit" disabled={!groupName.trim()} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 transition disabled:opacity-50">Create</button></div></form></motion.div></motion.div>}</AnimatePresence>
};

const ManageWorkspaceModal = ({ isOpen, onClose, currentGroupId, currentUserId }) => {
    const [members, setMembers] = useState([]); const [inviteEmails, setInviteEmails] = useState(''); const [isLoading, setIsLoading] = useState(true);
    const shareableLink = `${window.location.origin}/join/${currentGroupId}`;
    useEffect(() => { if (!isOpen || !db || !currentGroupId) return; setIsLoading(true); const membersRef = collection(db, `artifacts/${appId}/public/data/groups/${currentGroupId}/members`); const unsubscribe = onSnapshot(membersRef, (snapshot) => { setMembers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))); setIsLoading(false); }); return () => unsubscribe(); }, [isOpen, currentGroupId]);
    const handleInvite = async (e) => { e.preventDefault(); const emails = inviteEmails.split(',').map(email => email.trim()).filter(Boolean); if (emails.length === 0) return; console.log(`Inviting emails: ${emails.join(', ')} to group ${currentGroupId}`); alert(`Invitation logic triggered for:\n${emails.join('\n')}\n\nIn a real app, this would send an email with the link:\n${shareableLink}`); setInviteEmails(''); };
    return <AnimatePresence>{isOpen && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"><motion.div initial={{ y: 50, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 50, scale: 0.95 }} className="bg-white rounded-2xl w-full max-w-lg shadow-xl"><div className="p-6"><div className="flex justify-between items-start mb-4"><h2 className="text-xl font-bold text-gray-800">Manage "{currentGroupId}"</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100 transition"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button></div><div className="mb-6"><label className="block text-sm font-medium text-gray-700 mb-1">Shareable Invite Link</label><div className="flex gap-2"><input type="text" readOnly value={shareableLink} className="w-full p-2 bg-gray-100 border border-gray-300 rounded-lg text-sm text-gray-600"/><button onClick={() => navigator.clipboard.writeText(shareableLink)} className="px-3 py-2 bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-300 transition">Copy</button></div></div><form onSubmit={handleInvite} className="mb-6"><label htmlFor="invite-emails" className="block text-sm font-medium text-gray-700 mb-1">Invite by Email</label><div className="flex gap-2"><input id="invite-emails" type="text" value={inviteEmails} onChange={(e) => setInviteEmails(e.target.value)} placeholder="email1@example.com, ..." className="w-full p-2 border bg-white border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"/><button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-blue-700 transition disabled:opacity-50">Invite</button></div></form><div><h3 className="text-md font-semibold text-gray-800 mb-2">Members ({members.length})</h3><div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-2 bg-gray-50">{isLoading ? <p className="text-gray-500 text-sm">Loading...</p> : members.map(member => (<div key={member.id} className="flex justify-between items-center p-2 bg-white rounded-md"><span className="text-sm text-gray-700">{member.email}</span><span className="text-xs text-gray-500 uppercase font-semibold">{member.role}</span></div>))}</div></div></div></motion.div></motion.div>}</AnimatePresence>
};

const Footer = () => <footer className="w-full py-6 mt-auto"><p className="text-center text-sm text-gray-500">© {new Date().getFullYear()} Pragati Board. Built by Akshay Nayak.</p></footer>;

const JoinHandler = () => {
    const { groupId } = useParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState('Processing invite...');
    useEffect(() => {
        if (!auth) return;
        const user = auth.currentUser;
        if (user) {
            joinGroupSecurely(groupId, user)
                .then(() => {
                    localStorage.setItem('pragati-viewMode', 'group');
                    localStorage.setItem('pragati-currentGroupId', groupId);
                    navigate('/');
                })
                .catch(error => { console.error("Error joining group:", error); setStatus(`Error: ${error.message}`); });
        } else {
            sessionStorage.setItem('pending-join-groupId', groupId);
            navigate('/auth');
        }
    }, [groupId, navigate]);
    return <div className="flex items-center justify-center min-h-screen bg-gray-50 animated-bg"><div className="text-gray-700 font-medium text-lg">{status}</div></div>;
};

const TaskManagementView = ({ currentUserId, onLogout, currentUserEmail }) => {
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('pragati-viewMode') || 'private');
    const [currentGroupId, setCurrentGroupId] = useState(() => localStorage.getItem('pragati-currentGroupId') || '');
    const [userGroups, setUserGroups] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isDragOver, setIsDragOver] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterPriority, setFilterPriority] = useState('All');
    const [filterAssignee, setFilterAssignee] = useState('All');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTask, setEditingTask] = useState(null);
    const [showConfirm, setShowConfirm] = useState(false);
    const [taskToDeleteId, setTaskToDeleteId] = useState(null);
    const [showGroupDeleteConfirm, setShowGroupDeleteConfirm] = useState(false);
    const [groupToDelete, setGroupToDelete] = useState(null);
    const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
    const [showManageGroupModal, setShowManageGroupModal] = useState(false);

    useEffect(() => { localStorage.setItem('pragati-viewMode', viewMode); localStorage.setItem('pragati-currentGroupId', currentGroupId); }, [viewMode, currentGroupId]);
    useEffect(() => { if (!db || !currentUserId) return; const unsub = onSnapshot(collection(db, `users/${currentUserId}/groups`), (snap) => setUserGroups(snap.docs.map(d => ({ id: d.id, ...d.data() })))); return () => unsub(); }, [currentUserId]);
    useEffect(() => {
        if (!db || !currentUserId) return;
        const collectionPath = getTaskCollectionPath(currentUserId, viewMode, currentGroupId);
        if (!collectionPath) { setTasks([]); setLoading(false); return; }
        setLoading(true);
        const q = query(collection(db, collectionPath), orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, (snap) => {
            setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }, (err) => { console.error("Error fetching tasks:", err); setLoading(false); });
        return () => unsub();
    }, [currentUserId, viewMode, currentGroupId]);
    
    const uniqueAssignees = useMemo(() => ['All', ...Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean))).sort()], [tasks]);
    const groupedTasks = useMemo(() => { const groups = { 'To Do': [], 'In Progress': [], 'Done': [] }; tasks.filter(t => (searchTerm === '' || t.title.toLowerCase().includes(searchTerm.toLowerCase())) && (filterPriority === 'All' || t.priority === filterPriority) && (filterAssignee === 'All' || t.assignee === filterAssignee)).forEach(t => { if (groups[t.status]) groups[t.status].push(t); }); return groups; }, [tasks, searchTerm, filterPriority, filterAssignee]);
    
    const handleUpdateTaskStatus = async (taskId, newStatus) => {
        const path = getTaskCollectionPath(currentUserId, viewMode, currentGroupId);
        if (!path) { console.error("Update failed: No valid path."); return; }
        try { await updateDoc(doc(db, path, taskId), { status: newStatus }); } 
        catch (e) { console.error("Firestore update FAILED:", e); }
    };
    
    const handleCreateOrUpdateTask = async (taskData, taskId = null) => { const path = getTaskCollectionPath(currentUserId, viewMode, currentGroupId); if (!path) return; try { if (taskId) { await updateDoc(doc(db, path, taskId), taskData); } else { await addDoc(collection(db, path), { ...taskData, status: STATUSES[0], createdBy: currentUserEmail, createdAt: serverTimestamp() }); setIsModalOpen(false); } } catch(e) { console.error(e); }};
    const handleDeleteTask = async (taskId) => { const path = getTaskCollectionPath(currentUserId, viewMode, currentGroupId); if (!path) return; try { await deleteDoc(doc(db, path, taskId)); setShowConfirm(false); setTaskToDeleteId(null); } catch (e) { console.error(e); } };
    const handleCreateGroup = async (groupName, inviteEmails) => { if (!groupName.trim() || !currentUserId) return; const batch = writeBatch(db); const userGroupRef = doc(db, `users/${currentUserId}/groups`, groupName); batch.set(userGroupRef, { id: groupName, role: 'owner', joinedAt: serverTimestamp() }); const memberRef = doc(db, `artifacts/${appId}/public/data/groups/${groupName}/members`, currentUserId); batch.set(memberRef, { email: currentUserEmail, role: 'owner' }); await batch.commit(); console.log(`Group "${groupName}" created. Inviting: ${inviteEmails}`); alert(`Group "${groupName}" created!\nShare this link to invite others:\n${window.location.origin}/join/${groupName}`); setCurrentGroupId(groupName); setViewMode('group'); setShowCreateGroupModal(false); };
    const handleDeleteGroup = async (groupId) => { if (!groupId || !currentUserId) return; try { await deleteDoc(doc(db, `users/${currentUserId}/groups`, groupId)); if (currentGroupId === groupId) { setViewMode('private'); setCurrentGroupId(''); } setShowGroupDeleteConfirm(false); setGroupToDelete(null); } catch (error) { console.error("Error deleting group:", error); } };
    const confirmDeleteTask = (id) => { setTaskToDeleteId(id); setShowConfirm(true); }; 
    const openCreateModal = () => { setEditingTask(null); setIsModalOpen(true); }; 
    const openEditModal = (t) => { setEditingTask(t); setIsModalOpen(true); };
    
    const handleDragStart = (e, id, status) => { e.dataTransfer.setData("text/plain", JSON.stringify({ taskId: id, currentStatus: status })); e.currentTarget.classList.add('opacity-30'); }; 
    const handleDragEnd = (e) => e.currentTarget.classList.remove('opacity-30'); 
    const handleDragOver = (e, status) => { e.preventDefault(); setIsDragOver(status); }; 
    const handleDragLeave = () => setIsDragOver(null);
    const handleDrop = (e, targetStatus) => { e.preventDefault(); setIsDragOver(null); const data = e.dataTransfer.getData("text/plain"); if (!data) return; try { const { taskId, currentStatus } = JSON.parse(data); if (currentStatus !== targetStatus) handleUpdateTaskStatus(taskId, targetStatus); } catch (e) { console.error("Drop failed: Could not parse dataTransfer.", e); } };

    return (
        <div className="flex min-h-screen font-sans bg-gray-50 text-gray-800 animated-bg">
            <aside className="w-64 flex-shrink-0 bg-white/80 backdrop-blur-xl border-r border-gray-200 flex flex-col">
                <div className="flex items-center justify-center h-16 border-b border-gray-200 flex-shrink-0 px-4"><h1 className="text-xl font-bold text-gray-800 tracking-tight">Pragati Board</h1></div>
                <nav className="flex-grow p-4 space-y-2">
                    <p className="px-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Workspaces</p>
                    <button onClick={() => { setViewMode('private'); setCurrentGroupId(''); }} className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${viewMode === 'private' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>Individual</button>
                    {userGroups.map(group => (
                        <div key={group.id} className="group flex items-center justify-between">
                            <button onClick={() => { setViewMode('group'); setCurrentGroupId(group.id); }} className={`w-full text-left flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${viewMode === 'group' && currentGroupId === group.id ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>{group.id}</button>
                            <button onClick={() => { setCurrentGroupId(group.id); setShowManageGroupModal(true); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 mr-1 rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700" title={`Manage ${group.id}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01-.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg></button>
                            <button onClick={() => { setGroupToDelete(group.id); setShowGroupDeleteConfirm(true); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full text-gray-400 hover:bg-red-100 hover:text-red-600" title={`Delete ${group.id}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                        </div>
                    ))}
                    <button onClick={() => setShowCreateGroupModal(true)} className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors">+ Create Workspace</button>
                </nav>
            </aside>
            <div className="flex-1 flex flex-col">
                <header className="bg-white/50 backdrop-blur-xl sticky top-0 z-40 border-b border-gray-200"><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><div className="flex items-center justify-end h-16"><div className="flex items-center space-x-4"><span className="text-sm font-medium text-gray-500 hidden sm:block">{currentUserEmail}</span><button onClick={onLogout} className="px-3 py-1.5 bg-gray-200/70 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 transition">Logout</button></div></div></div>
                    <div className="border-t border-gray-200 py-3"><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><div className="flex flex-col md:flex-row items-center gap-4"><div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-grow gap-4 w-full"><input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="p-2 border bg-white border-gray-300 rounded-lg text-sm w-full focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-400"/><select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="p-2 border bg-white border-gray-300 rounded-lg text-sm w-full focus:ring-2 focus:ring-blue-500 text-gray-800"><option value="All">All Priorities</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select><select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className="p-2 border bg-white border-gray-300 rounded-lg text-sm w-full focus:ring-2 focus:ring-blue-500 text-gray-800"><option value="All">All Assignees</option>{uniqueAssignees.filter(a => a !== 'All').map(a => (<option key={a} value={a}>{a}</option>))}</select></div><button onClick={openCreateModal} className="flex items-center justify-center gap-2 w-full md:w-auto px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-blue-700 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" /></svg>New Task</button></div></div></div>
                </header>
                <main className="flex-grow max-w-7xl w-full mx-auto p-4 sm:px-6 lg:px-8">
                    {loading && <div className="text-center p-6 text-gray-500 font-medium">Loading tasks...</div>}
                    {viewMode === 'group' && !currentGroupId.trim() && !loading && <div className="p-6 text-center bg-blue-50 text-blue-800 rounded-xl border border-blue-200 mb-6 shadow-sm"><p className="font-semibold">Select a group from the sidebar or create a new one.</p></div>}
                    <motion.div layout className="grid grid-cols-1 md:grid-cols-3 gap-6">{STATUSES.map(status => <div key={status} onDragOver={(e) => handleDragOver(e, status)} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, status)}><div className="flex justify-between items-center mb-3"><h2 className="text-base font-bold text-gray-700 flex items-center gap-2">{status}</h2><span className="text-xs font-semibold bg-gray-200 text-gray-600 px-2 py-1 rounded-md">{groupedTasks[status].length}</span></div><div className={`h-full min-h-[60vh] bg-gray-100/60 rounded-xl p-3 transition-colors duration-300 ${isDragOver === status ? 'bg-blue-100' : ''}`}><AnimatePresence><div className="space-y-3">{groupedTasks[status].length > 0 ? (groupedTasks[status].map(task => <TaskCard key={task.id} {...{task, onEdit: openEditModal, onDelete: confirmDeleteTask, onDragStart: handleDragStart, onDragEnd: handleDragEnd}} />)) : (<div className="text-center py-10 px-4 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg mt-4"><p className="text-sm font-medium">{isDragOver === status ? 'Drop task to assign' : 'Drag a task here'}</p></div>)}</div></AnimatePresence></div></div>)}</motion.div>
                </main>
                <Footer />
                <TaskModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSubmit={handleCreateOrUpdateTask} initialTask={editingTask} currentUserId={currentUserId} currentUserEmail={currentUserEmail} viewMode={viewMode} currentGroupId={currentGroupId} />
                <CreateGroupModal isOpen={showCreateGroupModal} onClose={() => setShowCreateGroupModal(false)} onCreate={handleCreateGroup} />
                <ManageWorkspaceModal isOpen={showManageGroupModal} onClose={() => setShowManageGroupModal(false)} currentGroupId={currentGroupId} currentUserId={currentUserId} />
                {showConfirm && <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"><div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-xl"><h3 className="text-xl font-bold text-red-600 mb-3">Confirm Deletion</h3><p className="text-gray-700 mb-6">Are you sure? This action cannot be undone.</p><div className="flex justify-end space-x-3"><button onClick={() => { setShowConfirm(false); setTaskToDeleteId(null); }} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button><button onClick={() => handleDeleteTask(taskToDeleteId)} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg shadow-sm hover:bg-red-700">Delete</button></div></div></div>}
                {showGroupDeleteConfirm && <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"><motion.div initial={{ y: 50, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 50, scale: 0.95 }} className="bg-white rounded-xl w-full max-w-sm p-6 shadow-xl"><h3 className="text-xl font-bold text-red-600 mb-3">Delete Workspace</h3><p className="text-gray-700 mb-6">Are you sure you want to delete the "<strong>{groupToDelete}</strong>" workspace? This will only remove it from your list.</p><div className="flex justify-end space-x-3"><button onClick={() => { setShowGroupDeleteConfirm(false); setGroupToDelete(null); }} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button><button onClick={() => handleDeleteGroup(groupToDelete)} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg shadow-sm hover:bg-red-700">Delete</button></div></motion.div></div>}
            </div>
        </div>
    );
};

// --- ROOT APP COMPONENT ---
const App = () => {
    const [currentUserId, setCurrentUserId] = useState(null); const [currentUserEmail, setCurrentUserEmail] = useState(null); const [isAuthReady, setIsAuthReady] = useState(false); const [authLoading, setAuthLoading] = useState(false); const [authError, setAuthError] = useState(null);
    useEffect(() => {
        try {
            if (!app) { app = initializeApp(firebaseConfig); db = getFirestore(app); auth = getAuth(app); }
            const unsub = onAuthStateChanged(auth, (user) => { setCurrentUserId(user ? user.uid : null); setCurrentUserEmail(user ? user.email : null); setIsAuthReady(true); });
            return () => unsub();
        } catch (e) { console.error("Firebase setup error:", e); setIsAuthReady(true); }
    }, []);
    const handleAuthError = (error) => { setAuthLoading(false); let msg = "Authentication failed. Please try again."; if(error.code) { if (error.code.includes('invalid-email')) msg = "Invalid email format."; else if (error.code.includes('user-not-found') || error.code.includes('wrong-password')) msg = "Invalid email or password."; else if (error.code.includes('email-already-in-use')) msg = "This email is already registered."; } setAuthError(msg); console.error("Auth Error:", error); };
    const handleLogin = async (email, password) => {
        setAuthLoading(true); setAuthError(null);
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const pendingGroupId = sessionStorage.getItem('pending-join-groupId');
            if (pendingGroupId && userCredential.user) {
                await joinGroupSecurely(pendingGroupId, userCredential.user);
                sessionStorage.removeItem('pending-join-groupId');
            }
        } catch (e) { handleAuthError(e); } finally { setAuthLoading(false); }
    };
    const handleSignup = async (email, password) => {
        setAuthLoading(true); setAuthError(null);
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const pendingGroupId = sessionStorage.getItem('pending-join-groupId');
            if (pendingGroupId && userCredential.user) {
                await joinGroupSecurely(pendingGroupId, userCredential.user);
                sessionStorage.removeItem('pending-join-groupId');
            }
        } catch (e) { handleAuthError(e); } finally { setAuthLoading(false); }
    };
    const handleLogout = async () => { try { await signOut(auth); localStorage.removeItem('pragati-viewMode'); localStorage.removeItem('pragati-currentGroupId'); } catch (e) { console.error("Logout Error:", e); }};
    if (!isAuthReady) { return <div className="flex items-center justify-center min-h-screen bg-gray-50"><div className="text-gray-500 font-medium">Connecting...</div></div>; }
    
    return (
        <Router>
            <Routes>
                <Route path="/join/:groupId" element={<JoinHandler />} />
                <Route path="/auth" element={currentUserId ? <Navigate to="/" /> : <AuthScreen onLogin={handleLogin} onSignup={handleSignup} loading={authLoading} error={authError} />} />
                <Route path="/" element={currentUserId ? <TaskManagementView currentUserId={currentUserId} currentUserEmail={currentUserEmail} onLogout={handleLogout} /> : <Navigate to="/auth" />} />
                <Route path="*" element={<Navigate to="/" />} />
            </Routes>
        </Router>
    );
};

export default App;