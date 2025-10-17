import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, 
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut 
} from 'firebase/auth';
import { 
    getFirestore, doc, collection, onSnapshot, updateDoc, deleteDoc, addDoc, 
    serverTimestamp, setLogLevel, query, orderBy 
} from 'firebase/firestore';
// ✨ NEW: Import motion and AnimatePresence for animations
import { motion, AnimatePresence } from 'framer-motion';

// --- CONFIGURATION AND UTILITIES ---

const appId = 'default-app-id';
const firebaseConfig = {
 
};
const initialAuthToken = null;

let app, db, auth;

const STATUSES = ['To Do', 'In Progress', 'Done'];
const PRIORITY_COLORS = {
  High: 'bg-red-100/60 text-red-800 ring-red-300',
  Medium: 'bg-yellow-100/60 text-yellow-800 ring-yellow-300',
  Low: 'bg-green-100/60 text-green-800 ring-green-300',
};

const getTaskCollectionPath = (userId, viewMode, groupId) => {
    if (!userId) return null;
    if (viewMode === 'group' && groupId.trim()) {
        return `artifacts/${appId}/public/data/groups/${groupId.trim()}/tasks`;
    } else {
        return `artifacts/${appId}/users/${userId}/tasks`;
    }
};

const getCommentCollectionPath = (userId, viewMode, groupId, taskId) => {
    if (!taskId) return null;
    const taskPath = getTaskCollectionPath(userId, viewMode, groupId);
    return taskPath ? `${taskPath}/${taskId}/comments` : null;
};


// --- Comments Section Component (No changes) ---

const CommentsSection = ({ userId, currentUserEmail, taskId, viewMode, groupId }) => {
    const [comments, setComments] = useState([]);
    const [newComment, setNewComment] = useState('');
    const commentCollectionPath = getCommentCollectionPath(userId, viewMode, groupId, taskId);

    useEffect(() => {
        if (!db || !commentCollectionPath) return;
        const commentsQuery = query(collection(db, commentCollectionPath), orderBy('createdAt', 'asc'));
        const unsubscribe = onSnapshot(commentsQuery, (snapshot) => {
            setComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, (error) => console.error("Error fetching comments:", error));
        return () => unsubscribe();
    }, [commentCollectionPath]);

    const handleAddComment = async (e) => {
        e.preventDefault();
        if (!db || !commentCollectionPath || !newComment.trim()) return;
        try {
            await addDoc(collection(db, commentCollectionPath), {
                text: newComment.trim(),
                createdBy: currentUserEmail || `User ${userId.substring(0, 8)}`,
                createdAt: serverTimestamp(),
            });
            setNewComment('');
        } catch (e) { console.error("Error adding comment: ", e); }
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return 'Just now';
        return new Date(timestamp.seconds * 1000).toLocaleString();
    };

    return (
        <div className="mt-6 bg-slate-50/75 p-4 rounded-lg border border-slate-200">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Comments ({comments.length})</h3>
            <div className="space-y-4 max-h-60 overflow-y-auto pr-2 mb-4">
                {comments.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">Be the first to leave a comment.</p>
                ) : (
                    comments.map(comment => (
                        <div key={comment.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                            <div className="flex justify-between items-center text-xs mb-1">
                                <span className="font-semibold text-blue-700">{comment.createdBy}</span>
                                <span className="text-slate-500">{formatDate(comment.createdAt)}</span>
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{comment.text}</p>
                        </div>
                    ))
                )}
            </div>
            <form onSubmit={handleAddComment} className="flex space-x-2">
                <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} rows="2"
                    className="flex-grow p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none text-sm bg-white"
                    placeholder="Write a comment..." />
                <button type="submit" disabled={!newComment.trim()}
                    className="self-end px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-md hover:bg-blue-700 transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed">
                    Post
                </button>
            </form>
        </div>
    );
};


// --- Task Card Component (Animated) ---

const TaskCard = ({ task, onEdit, onDelete, onDragStart, onDragEnd }) => {
  const priorityStyle = PRIORITY_COLORS[task.priority] || 'bg-slate-100 text-slate-600 ring-slate-200';

  return (
    // ✨ NEW: Wrapped with motion.div for animation
    <motion.div 
      layout // This prop animates the card when its position changes
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="bg-white/90 p-4 rounded-xl shadow-md border border-slate-200 hover:shadow-lg hover:border-blue-500 transition-all duration-200 flex flex-col space-y-3 cursor-grab active:cursor-grabbing"
      draggable="true"
      onDragStart={(e) => onDragStart(e, task.id, task.status)}
      onDragEnd={onDragEnd}
    >
      <div className="flex justify-between items-start gap-2">
        <h3 className="text-base font-semibold text-slate-800 break-words flex-grow">{task.title}</h3>
        <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ring-1 ${priorityStyle}`}>
          {task.priority}
        </span>
      </div>
      <p className="text-sm text-slate-600 break-words line-clamp-2">{task.description || 'No description provided.'}</p>
      
      <div className="flex justify-between items-center text-xs pt-3 border-t border-slate-100">
        <p className="text-slate-500">
          Assignee: <span className="font-medium text-slate-700">{task.assignee || 'Unassigned'}</span>
        </p>
        <div className="flex space-x-1">
          <button onClick={() => onEdit(task)} className="text-slate-500 hover:text-blue-600 p-1.5 rounded-full hover:bg-blue-50 transition duration-150" title="Edit Task / View Details">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L14.732 3.732z" />
            </svg>
          </button>
          <button onClick={() => onDelete(task.id)} className="text-slate-500 hover:text-red-600 p-1.5 rounded-full hover:bg-red-50 transition duration-150" title="Delete Task">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </motion.div>
  );
};


// --- Task Modal Component (No changes) ---
const TaskModal = ({ isOpen, onClose, onSubmit, initialTask, currentUserId, currentUserEmail, viewMode, currentGroupId }) => {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState(initialTask?.status || STATUSES[0]);
    const [priority, setPriority] = useState(initialTask?.priority || 'Medium');
    const [assignee, setAssignee] = useState(initialTask?.assignee || '');

    useEffect(() => {
        if (initialTask) {
            setTitle(initialTask.title || ''); setDescription(initialTask.description || ''); setStatus(initialTask.status || STATUSES[0]);
            setPriority(initialTask.priority || 'Medium'); setAssignee(initialTask.assignee || '');
        } else {
            setTitle(''); setDescription(''); setStatus(STATUSES[0]); setPriority('Medium'); setAssignee('');
        }
    }, [initialTask, isOpen]);

    const handleSubmit = (e) => {
        e.preventDefault(); if (!title.trim()) return;
        onSubmit({ title: title.trim(), description: description.trim(), priority, assignee: assignee.trim(), status }, initialTask ? initialTask.id : null);
        if (!initialTask) onClose();
    };
    
    const handleQuickStatusUpdate = (newStatus) => {
        setStatus(newStatus);
        if (initialTask) onSubmit({ status: newStatus }, initialTask.id);
    };

    if (!isOpen) return null;
    const isEditing = !!initialTask;

    return (
        <AnimatePresence>
          {isOpen && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 overflow-y-auto">
                <motion.div 
                  initial={{ y: 50, scale: 0.9 }} animate={{ y: 0, scale: 1 }} exit={{ y: 50, scale: 0.9 }}
                  className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-8">
                    <div className="p-8">
                        <div className="flex justify-between items-start mb-6 pb-4 border-b border-slate-200">
                            <h2 className="text-2xl font-bold text-slate-800">{isEditing ? 'Task Details' : 'Create New Task'}</h2>
                            <button onClick={onClose} className="text-slate-400 hover:text-slate-800 p-1 rounded-full hover:bg-slate-100 transition duration-150">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div>
                                <label htmlFor="title" className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                                <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required
                                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="e.g., Implement new user dashboard" />
                            </div>
                            <div>
                                <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                                <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows="4"
                                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                                    placeholder="Add more details about the task..." />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label htmlFor="status" className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                                    <select id="status" value={status} onChange={(e) => handleQuickStatusUpdate(e.target.value)}
                                        className="w-full p-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="priority" className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                                    <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)}
                                        className="w-full p-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                                        {['High', 'Medium', 'Low'].map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                                 <div>
                                    <label htmlFor="assignee" className="block text-sm font-medium text-slate-700 mb-1">Assignee</label>
                                    <input id="assignee" type="text" value={assignee} onChange={(e) => setAssignee(e.target.value)}
                                        className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="e.g., Jane Doe" />
                                </div>
                            </div>
                            <div className="flex justify-end space-x-3 pt-4">
                                <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition duration-150">
                                    {isEditing ? 'Close' : 'Cancel'}
                                </button>
                                <button type="submit" className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-md hover:bg-blue-700 transition duration-150 disabled:opacity-50" disabled={!title.trim()}>
                                    {isEditing ? 'Save Changes' : 'Create Task'}
                                </button>
                            </div>
                        </form>
                        {isEditing && (
                            <CommentsSection userId={currentUserId} currentUserEmail={currentUserEmail} taskId={initialTask.id}
                                viewMode={viewMode} groupId={currentGroupId} />
                        )}
                    </div>
                </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
    );
};


// --- Auth Screen Component (No changes) ---
const AuthScreen = ({ onLogin, onSignup, loading, error }) => {
    const [isLoginView, setIsLoginView] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isLoginView) onLogin(email, password);
        else onSignup(email, password);
    };

    return (
        <div className="flex items-center justify-center min-h-screen gradient-bg p-4">
            <motion.div 
                initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md bg-white/80 backdrop-blur-lg p-8 rounded-2xl shadow-xl border border-white/30">
                <h2 className="text-3xl font-bold text-center text-slate-800 mb-2">{isLoginView ? 'Welcome Back!' : 'Create an Account'}</h2>
                <p className="text-center text-slate-500 mb-8">Manage your tasks like a pro.</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                            className="w-full p-3 bg-white/70 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-150"
                            placeholder="you@example.com" />
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                            className="w-full p-3 bg-white/70 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-150"
                            placeholder="••••••••" />
                    </div>
                    {error && <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-md text-sm" role="alert"><p>{error}</p></div>}
                    <button type="submit" disabled={loading}
                        className="w-full py-3 bg-blue-600 text-white text-base font-semibold rounded-lg shadow-lg hover:bg-blue-700 transition duration-300 disabled:opacity-50 flex items-center justify-center">
                        {loading ? <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : isLoginView ? 'Log In' : 'Sign Up'}
                    </button>
                </form>
                <button onClick={() => setIsLoginView(!isLoginView)} className="mt-6 w-full text-center text-sm text-blue-600 hover:underline transition duration-150">
                    {isLoginView ? "Don't have an account? Sign Up" : 'Already have an account? Log In'}
                </button>
            </motion.div>
        </div>
    );
};


// ✨ NEW: Footer Component
const Footer = () => {
  return (
    <footer className="w-full py-4 mt-12">
      <p className="text-center text-sm text-slate-500">
        © {new Date().getFullYear()} Pragati Board. Built by Akshay Nayak.
      </p>
    </footer>
  );
};

// --- Task Management View Component (Major Overhaul) ---

const TaskManagementView = ({ currentUserId, onLogout, currentUserEmail }) => {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('private');
    const [currentGroupId, setCurrentGroupId] = useState('');
    const [groupIdInput, setGroupIdInput] = useState('');
    const [isDragOver, setIsDragOver] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterPriority, setFilterPriority] = useState('All');
    const [filterAssignee, setFilterAssignee] = useState('All');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTask, setEditingTask] = useState(null);
    const [showConfirm, setShowConfirm] = useState(false);
    const [taskToDeleteId, setTaskToDeleteId] = useState(null);
    
    useEffect(() => {
      if (!db || !currentUserId) return;
  
      // ✨ NEW FIX: If in group mode but no group is selected, clear tasks and stop.
      if (viewMode === 'group' && !currentGroupId.trim()) {
          setTasks([]);
          setLoading(false);
          return; // <-- Exit early
      }
  
      const collectionPath = getTaskCollectionPath(currentUserId, viewMode, currentGroupId);
      if (!collectionPath) {
          setTasks([]);
          setLoading(false);
          return;
      }
  
      setLoading(true);
      const unsubscribe = onSnapshot(collection(db, collectionPath), (snapshot) => {
          const newTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          newTasks.sort((a, b) => {
              const pA = ['High', 'Medium', 'Low'].indexOf(a.priority);
              const pB = ['High', 'Medium', 'Low'].indexOf(b.priority);
              if (pA !== pB) return pA - pB;
              return a.title.localeCompare(b.title);
          });
          setTasks(newTasks); 
          setLoading(false);
      }, (error) => { 
          console.error("Error fetching tasks:", error); 
          setLoading(false); 
          if (error.code === 'permission-denied') setTasks([]); 
      });
      return () => unsubscribe();
  }, [currentUserId, viewMode, currentGroupId]); 

    const uniqueAssignees = useMemo(() => ['All', ...Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean))).sort()], [tasks]);
    const groupedTasks = useMemo(() => {
        const groups = { 'To Do': [], 'In Progress': [], 'Done': [] };
        tasks.filter(task => {
            const searchLower = searchTerm.toLowerCase();
            return (!searchLower || task.title.toLowerCase().includes(searchLower) || (task.description && task.description.toLowerCase().includes(searchLower))) &&
                   (filterPriority === 'All' || task.priority === filterPriority) &&
                   (filterAssignee === 'All' || task.assignee === filterAssignee);
        }).forEach(task => { if (groups[task.status]) groups[task.status].push(task); });
        return groups;
    }, [tasks, searchTerm, filterPriority, filterAssignee]);

    const handleCreateOrUpdateTask = async (taskData, taskId = null) => {
        const collectionPath = getTaskCollectionPath(currentUserId, viewMode, currentGroupId);
        if (!db || !currentUserId || !collectionPath) return;
        try {
            if (taskId) {
                await updateDoc(doc(db, collectionPath, taskId), taskData);
            } else {
                await addDoc(collection(db, collectionPath), { ...taskData, status: STATUSES[0], createdBy: currentUserEmail || `User ${currentUserId.substring(0, 8)}`, createdAt: serverTimestamp() });
                setIsModalOpen(false); 
            }
        } catch (e) { console.error("Error writing document: ", e); }
    };

    const handleUpdateTaskStatus = async (taskId, newStatus) => {
        const collectionPath = getTaskCollectionPath(currentUserId, viewMode, currentGroupId);
        if (!collectionPath) return;
        try { await updateDoc(doc(db, collectionPath, taskId), { status: newStatus }); } catch (e) { console.error("Error updating status: ", e); }
    };

    const handleDeleteTask = async (taskId) => {
        const collectionPath = getTaskCollectionPath(currentUserId, viewMode, currentGroupId);
        if (!collectionPath) return;
        try { await deleteDoc(doc(db, collectionPath, taskId)); setShowConfirm(false); setTaskToDeleteId(null); } 
        catch (e) { console.error("Error deleting document: ", e); }
    };

    const confirmDelete = (taskId) => { setTaskToDeleteId(taskId); setShowConfirm(true); };
    const handleOpenCreateModal = () => { setEditingTask(null); setIsModalOpen(true); };
    const handleOpenEditModal = (task) => { setEditingTask(task); setIsModalOpen(true); };
    const handleGroupSwitch = () => { if (groupIdInput.trim()) { setCurrentGroupId(groupIdInput.trim()); setViewMode('group'); } };
    const handleGroupInputKeyDown = (e) => { if (e.key === 'Enter') handleGroupSwitch(); };
    const viewTitle = viewMode === 'private' ? 'My Private Tasks' : currentGroupId.trim() ? `Group: ${currentGroupId.trim()}` : 'Group Projects';
    const handleDragStart = (e, taskId, currentStatus) => { e.dataTransfer.setData("text/plain", JSON.stringify({ taskId, currentStatus })); e.currentTarget.classList.add('opacity-50', 'ring-4', 'ring-blue-400', 'shadow-2xl'); };
    const handleDragEnd = (e) => { e.currentTarget.classList.remove('opacity-50', 'ring-4', 'ring-blue-400', 'shadow-2xl'); setIsDragOver(null); };
    const handleDragOver = (e, status) => { e.preventDefault(); setIsDragOver(status); };
    const handleDragLeave = () => { setIsDragOver(null); };
    const handleDrop = (e, targetStatus) => {
        e.preventDefault(); setIsDragOver(null);
        const data = e.dataTransfer.getData("text/plain"); if (!data) return;
        try { const { taskId, currentStatus } = JSON.parse(data); if (currentStatus !== targetStatus) handleUpdateTaskStatus(taskId, targetStatus); } 
        catch (error) { console.error("Error parsing drag data:", error); }
    };

    return (
        <div className="min-h-screen font-sans gradient-bg">
            
            {/* ✨ NEW: Glassmorphism Header */}
            <header className="bg-white/60 backdrop-blur-lg shadow-sm sticky top-0 z-40 p-4 border-b border-white/30">
                {/* ... (Header content remains the same) ... */}
                <div className="max-w-7xl mx-auto">
                    <div className="flex justify-between items-center mb-4">
                        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Pragati Board: <span className="text-blue-600">{viewTitle}</span></h1>
                        <div className="flex items-center space-x-4">
                            <span className="text-sm font-medium text-slate-600 hidden sm:block"><span className="font-semibold text-slate-800">{currentUserEmail || 'User ID ' + currentUserId.substring(0, 8) + '...'}</span></span>
                            <button onClick={onLogout} className="px-4 py-2 bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-300 transition duration-300">Logout</button>
                        </div>
                    </div>
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                        <div className="flex space-x-1 p-1 bg-slate-200/70 rounded-lg w-full lg:w-auto">
                            <button onClick={() => {setViewMode('private'); setCurrentGroupId(''); setGroupIdInput('');}} className={`px-4 py-1.5 text-sm font-semibold rounded-md transition duration-200 w-1/2 lg:w-auto ${viewMode === 'private' ? 'bg-white text-blue-600 shadow' : 'text-slate-700 hover:bg-white/50'}`}>Individual</button>
                            <button onClick={() => setViewMode('group')} className={`px-4 py-1.5 text-sm font-semibold rounded-md transition duration-200 w-1/2 lg:w-auto ${viewMode === 'group' ? 'bg-white text-blue-600 shadow' : 'text-slate-700 hover:bg-white/50'}`}>Group</button>
                        </div>
                        {viewMode === 'group' && (
                            <div className="flex space-x-2 w-full lg:w-auto lg:flex-grow lg:max-w-sm">
                                <input type="text" value={groupIdInput} onChange={(e) => setGroupIdInput(e.target.value)} onKeyDown={handleGroupInputKeyDown} placeholder="Enter Group ID to Join/Create" className="flex-grow p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/70" />
                                <button onClick={handleGroupSwitch} disabled={!groupIdInput.trim()} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-md hover:bg-blue-700 transition duration-300 disabled:opacity-50">Go</button>
                            </div>
                        )}
                        <button onClick={handleOpenCreateModal} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-lg hover:bg-blue-700 transition duration-300 w-full lg:w-auto ml-auto">
                             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" /></svg>
                            Add New Task
                        </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 mt-4 border-t border-white/30">
                          <input type="text" placeholder="Search tasks..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="p-2 border border-slate-300 rounded-lg text-sm w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/70"/>
                          <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="p-2 border border-slate-300 rounded-lg text-sm bg-white/70 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                              <option value="All">All Priorities</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
                          </select>
                          <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className="p-2 border border-slate-300 rounded-lg text-sm bg-white/70 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                              <option value="All">All Assignees</option>{uniqueAssignees.filter(a => a !== 'All').map(assignee => (<option key={assignee} value={assignee}>{assignee}</option>))}
                          </select>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
                {loading && ( <div className="text-center p-6 text-white/80 font-medium">Loading tasks...</div> )}
                {viewMode === 'group' && !currentGroupId.trim() && !loading && ( <div className="p-6 text-center bg-yellow-100/80 text-yellow-900 rounded-xl border border-yellow-300 mb-6 shadow-lg"><p className="font-semibold">Please enter a Group ID above to view shared tasks.</p></div>)}
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {STATUSES.map(status => (
                        <div key={status} onDragOver={(e) => handleDragOver(e, status)} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, status)}>
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                  {status === 'To Do' && <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h7.5M8.25 12h7.5m-7.5 5.25h7.5M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>}
                                  {status === 'In Progress' && <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001a1.987 1.987 0 0 0-1.523-1.983C17.483 7.11 16 7.5 16 7.5s-1.483-.39-2.992-.083A1.987 1.987 0 0 0 11.5 9.348v7.104a1.987 1.987 0 0 0 1.523 1.983C14.517 18.89 16 18.5 16 18.5s1.483.39 2.992.083a1.987 1.987 0 0 0 1.523-1.983v-7.104Z" /></svg>}
                                  {status === 'Done' && <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>}
                                  {status}
                                </h2>
                                <span className="text-sm font-semibold bg-slate-200/80 text-slate-600 px-2.5 py-1 rounded-full">{groupedTasks[status].length}</span>
                            </div>
                            <div className={`h-full min-h-[400px] rounded-xl p-4 transition-colors duration-300 ${isDragOver === status ? 'bg-white/90' : 'bg-white/50'}`}>
                                <AnimatePresence>
                                  <div className="space-y-4">
                                      {groupedTasks[status].length > 0 ? (
                                          groupedTasks[status].map(task => (
                                              <TaskCard key={task.id} task={task} onEdit={handleOpenEditModal} onDelete={confirmDelete} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
                                          ))
                                      ) : (
                                          <div className={`text-center py-10 px-4 text-slate-400 border-2 border-dashed border-slate-300/80 rounded-lg transition-opacity duration-300`}>
                                              <p className="text-sm font-medium">{isDragOver === status ? 'Drop task to assign' : 'No tasks here.'}</p>
                                          </div>
                                      )}
                                  </div>
                                </AnimatePresence>
                            </div>
                        </div>
                    ))}
                </div>
                
                <Footer />
            </main>
            
            <TaskModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSubmit={handleCreateOrUpdateTask} initialTask={editingTask} currentUserId={currentUserId} currentUserEmail={currentUserEmail} viewMode={viewMode} currentGroupId={currentGroupId} />
            
            {showConfirm && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-2xl">
                        <h3 className="text-xl font-bold text-red-600 mb-3">Confirm Deletion</h3>
                        <p className="text-slate-700 mb-6">Are you sure? This action cannot be undone.</p>
                        <div className="flex justify-end space-x-3">
                            <button onClick={() => { setShowConfirm(false); setTaskToDeleteId(null); }} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Cancel</button>
                            <button onClick={() => handleDeleteTask(taskToDeleteId)} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg shadow-md hover:bg-red-700">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


// --- ROOT APP COMPONENT ---

const App = () => {
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserEmail, setCurrentUserEmail] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  // ✨ REPLACE the old useEffect with this new one
  useEffect(() => {
      try {
          // Initialize Firebase only once
          if (!app) {
              app = initializeApp(firebaseConfig);
              db = getFirestore(app);
              auth = getAuth(app);
          }
          
          // onAuthStateChanged is the key to persistence. 
          // It runs once on page load after checking Firebase's storage.
          const unsubscribe = onAuthStateChanged(auth, (user) => {
              if (user) {
                  // If a user was logged in before, Firebase restores them here.
                  setCurrentUserId(user.uid);
                  setCurrentUserEmail(user.email);
              } else {
                  // If no one was logged in, user is null.
                  setCurrentUserId(null);
                  setCurrentUserEmail(null);
              }
              // We're ready to show the UI only after this first check is done.
              setIsAuthReady(true);
          });

          return () => unsubscribe(); // Cleanup on component unmount

      } catch (e) {
          console.error("Firebase setup error:", e);
          setIsAuthReady(true); // Ensure app doesn't hang on an error
      }
  }, []); // Empty dependency array ensures this runs only once.


  // ... (the rest of your App component's code remains the same)
  // const handleAuthError = ...
  // const handleLogin = ...
  // etc.
  const handleAuthError = (error) => {
      setAuthLoading(false);
      let message = "An unknown error occurred.";
      if (error.code) {
          if (error.code.includes('invalid-email')) message = "Invalid email format.";
          else if (error.code.includes('user-not-found') || error.code.includes('wrong-password')) message = "Invalid email or password.";
          else if (error.code.includes('email-already-in-use')) message = "This email is already registered.";
          else message = "Authentication failed. Please try again.";
      }
      setAuthError(message);
      console.error("Auth Error:", error);
  };

  const handleLogin = async (email, password) => {
      setAuthLoading(true); setAuthError(null);
      try { await signInWithEmailAndPassword(auth, email, password); } 
      catch (error) { handleAuthError(error); } 
      finally { setAuthLoading(false); }
  };

  const handleSignup = async (email, password) => {
      setAuthLoading(true); setAuthError(null);
      try { await createUserWithEmailAndPassword(auth, email, password); } 
      catch (error) { handleAuthError(error); } 
      finally { setAuthLoading(false); }
  };

  const handleLogout = async () => { try { await signOut(auth); } catch (error) { console.error("Logout Error:", error); }};

  if (!isAuthReady) {
      return <div className="flex items-center justify-center min-h-screen gradient-bg"><div className="text-white/80 font-medium text-lg">Connecting...</div></div>;
  }

  if (!currentUserId) {
      return <AuthScreen onLogin={handleLogin} onSignup={handleSignup} loading={authLoading} error={authError} />;
  }
  
  return <TaskManagementView currentUserId={currentUserId} currentUserEmail={currentUserEmail} onLogout={handleLogout} />;
};

export default App;