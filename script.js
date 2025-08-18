// Global state - only keeping runtime timer state, everything else from Todoist
let currentTimer = null;
let timerState = {
    duration: 25 * 60, // 25 minutes in seconds
    remaining: 25 * 60,
    isRunning: false,
    isPaused: false,
    startTime: null,
    currentTask: null,
    actualStartTime: null, // Track actual start time for accurate timing
    pausedTime: 0 // Track total paused time
};

let todoistToken = '';
let currentPeriod = 'day';
let tasks = [];
let settings = {
    diamondDuration: 25,
    defaultTaskTime: 25
};

// Cache for completed tasks to avoid repeated API calls
let completedTasksCache = null;

// Cache for labels to avoid repeated API calls
let labelsCache = null;

// Sequential color assignment tracking
let tagColorAssignments = {};
let nextColorIndex = 0;

// Goals storage via single Inbox task comment
const SERVICE_TASK_NAME = 'deloist_service';
const GOALS_DOC_MARKER = 'DELOIST_GOALS_JSON';
let serviceTaskIdCache = localStorage.getItem('deloist_service_task_id') || null;
let goalsDocCache = null;
let goalsDocCommentIdCache = null;
let goalsCacheReady = false; // whether we've fetched and can render without re-fetch
let goalsSubtab = 'current'; // 'current' | 'completed'

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    loadSettings();
    updateTimerDisplay();
    updateTabTitle(); // Initialize tab title
    if (todoistToken) {
        loadTasks();
    }
});

// Function to update browser tab title
function updateTabTitle() {
    let title = '🌀 Deloist';
    
    if (timerState.isRunning || timerState.isPaused) {
        const minutes = Math.floor(timerState.remaining / 60);
        const seconds = timerState.remaining % 60;
        const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        if (timerState.currentTask) {
            const currentTaskData = tasks.find(t => t.id === timerState.currentTask);
            const taskName = currentTaskData ? currentTaskData.content : 'Unknown Task';
            title = `${timeStr} - ${taskName}`;
        } else {
            title = `${timeStr} - Timer Running`;
        }
    }
    
    document.title = title;
}

// Settings management - only store token and basic settings
function loadSettings() {
    const savedSettings = localStorage.getItem('deloist_settings');
    if (savedSettings) {
        settings = { ...settings, ...JSON.parse(savedSettings) };
    }
    
    todoistToken = localStorage.getItem('deloist_token') || '';
    document.getElementById('todoist-token').value = todoistToken;
    document.getElementById('diamond-duration').value = settings.diamondDuration;
    document.getElementById('default-time').value = settings.defaultTaskTime;
    
    timerState.duration = settings.diamondDuration * 60;
    timerState.remaining = settings.diamondDuration * 60;
    updateTimerDisplay();
}

function saveSettings() {
    todoistToken = document.getElementById('todoist-token').value;
    settings.diamondDuration = parseInt(document.getElementById('diamond-duration').value);
    settings.defaultTaskTime = parseInt(document.getElementById('default-time').value);
    
    localStorage.setItem('deloist_token', todoistToken);
    localStorage.setItem('deloist_settings', JSON.stringify(settings));
    
    timerState.duration = settings.diamondDuration * 60;
    timerState.remaining = settings.diamondDuration * 60;
    updateTimerDisplay();
    
    closeSettings();
    
    if (todoistToken) {
        loadTasks();
    }
}

function openSettings() {
    document.getElementById('settings-modal').style.display = 'block';
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

// Tab management
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // Update refresh button tooltip based on current tab
    const refreshBtn = document.querySelector('[onclick="contextualRefresh()"]');
    if (refreshBtn) {
        if (tabName === 'tracker') {
            refreshBtn.title = 'Refresh today\'s tasks';
        } else if (tabName === 'goals') {
            refreshBtn.title = 'Refresh goals';
        } else if (tabName === 'stats') {
            refreshBtn.title = 'Refresh statistics';
        }
    }
    
    // Update tab title (timer will show even on other tabs if running)
    updateTabTitle();
    
    if (tabName === 'stats') {
        // Use cached data if available, otherwise show no data message
        if (completedTasksCache) {
            updateStatistics();
        } else {
            showNoDataWithRefreshPrompt();
        }
    } else if (tabName === 'goals') {
        loadGoals(false);
    }
}

// Goals sub-tabs (Current / Completed)
function switchGoalsSubtab(name) {
    goalsSubtab = (name === 'completed') ? 'completed' : 'current';
    // Update active state on subtab buttons
    const subtabs = document.querySelectorAll('#goals-subtabs .nav-tab');
    subtabs.forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`#goals-subtabs .nav-tab[onclick="switchGoalsSubtab('${goalsSubtab}')"]`);
    if (activeBtn) activeBtn.classList.add('active');
    if (goalsCacheReady && labelsCache && goalsDocCache) {
        renderGoals(labelsCache, goalsDocCache);
    }
}

// Fetch all labels from Todoist API
async function fetchLabelsFromTodoist() {
    if (labelsCache) {
        return labelsCache;
    }
    
    try {
        const response = await fetch('https://api.todoist.com/rest/v2/labels', {
            headers: {
                'Authorization': `Bearer ${todoistToken}`
            }
        });
        
        if (response.ok) {
            labelsCache = await response.json();
            return labelsCache;
        }
    } catch (error) {
        console.error('Error fetching labels:', error);
    }
    
    return [];
}

// Enhanced function to parse task labels and duration from API response
function parseTaskLabelsAndDuration(task, allLabels = []) {
    const result = {
        labels: [],
        duration: null
    };
    
    // Minimal parsing, no debug logs
    
    // Create label lookup map
    const labelMap = {};
    allLabels.forEach(label => {
        labelMap[label.id] = label.name;
        labelMap[String(label.id)] = label.name;
    });
    
    // Parse labels - handle different formats
    if (task.labels) {
        if (Array.isArray(task.labels)) {
            // Modern API format: labels is array of strings or IDs
            result.labels = task.labels
                .map(label => {
                    // Handle both string labels and ID references
                    if (typeof label === 'string') {
                        // Check if it's a label name or try to resolve as ID
                        return labelMap[label] || label;
                    } else if (typeof label === 'number') {
                        // Resolve label ID to name
                        return labelMap[label] || labelMap[String(label)] || `label_${label}`;
                    }
                    return null;
                })
                .filter(label => label && label.trim() !== '');
        } else if (typeof task.labels === 'string') {
            // Legacy format: comma-separated string
            result.labels = task.labels.split(',')
                .map(label => {
                    const trimmedLabel = label.trim();
                    // Try to resolve as ID first, then use as-is
                    return labelMap[trimmedLabel] || trimmedLabel;
                })
                .filter(label => label !== '');
        }
    }
    
    // Parse duration from API
    if (task.duration && typeof task.duration === 'object') {
        const amount = task.duration.amount;
        const unit = task.duration.unit;
        
        if (typeof amount === 'number' && amount > 0) {
            if (unit === 'minute') {
                result.duration = amount;
            } else if (unit === 'hour') {
                result.duration = amount * 60;
            } else if (unit === 'day') {
                result.duration = amount * 60 * 24;
            }
        }
    }
    
    // If no labels found from API, check task content for emoji-based labels and @mentions
    if (result.labels.length === 0) {
        const contentLabels = extractEmojiLabels(task.content || '');
        result.labels = contentLabels;
    } else {
        // Also add content-based labels to supplement API labels
        const contentLabels = extractEmojiLabels(task.content || '');
        result.labels = [...result.labels, ...contentLabels];
    }
    
    // Ensure we have unique labels
    result.labels = [...new Set(result.labels)];
    
    
    return result;
}

// Function to extract emoji-based labels from task content
function extractEmojiLabels(content) {
    const labels = [];
    
    // Extract emoji patterns (can be just emoji, emoji+word, etc.)
    // This regex matches emojis followed by optional text without spaces
    const emojiPattern = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    
    // Also look for @label patterns
    const mentionPattern = /@([^\s@]+)/g;
    
    let match;
    
    // Extract emoji labels
    while ((match = emojiPattern.exec(content)) !== null) {
        const emoji = match[0];
        // Look for text immediately following emoji (no space)
        const restOfContent = content.slice(match.index + emoji.length);
        const wordMatch = restOfContent.match(/^[a-zA-Z]+/);
        
        if (wordMatch) {
            labels.push(emoji + wordMatch[0]);
        } else {
            labels.push(emoji);
        }
    }
    
    // Extract @mention labels
    while ((match = mentionPattern.exec(content)) !== null) {
        labels.push(match[1]);
    }
    
    return labels;
}

// Todoist API integration - only fetch today's tasks
async function loadTasks() {
    if (!todoistToken) {
        document.getElementById('task-list').innerHTML = 
            '<div class="loading"><p>Please add your Todoist token in settings</p></div>';
        return;
    }

    try {
        document.getElementById('task-list').innerHTML = 
            '<div class="loading"><p>Loading today\'s tasks...</p></div>';

        const response = await fetch('https://api.todoist.com/rest/v2/tasks', {
            headers: {
                'Authorization': `Bearer ${todoistToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch tasks');
        }

        const allTasks = await response.json();
        
        // Filter for today's tasks only
        const today = new Date();
        const localDateString = today.getFullYear() + '-' + 
            String(today.getMonth() + 1).padStart(2, '0') + '-' + 
            String(today.getDate()).padStart(2, '0');
        
        tasks = allTasks.filter(task => {
            if (!task.due) return false;
            
            // Check if task has due.date matching today
            if (task.due.date === localDateString) {
                return true;
            }
            
            // Check if task has due.datetime falling on today (regardless of time)
            if (task.due.datetime) {
                const dueDatetime = new Date(task.due.datetime);
                const dueDateString = dueDatetime.getFullYear() + '-' + 
                    String(dueDatetime.getMonth() + 1).padStart(2, '0') + '-' + 
                    String(dueDatetime.getDate()).padStart(2, '0');
                return dueDateString === localDateString;
            }
            
            return false;
        });

        // Fetch labels for parsing
        const allLabels = await fetchLabelsFromTodoist();

        // Parse labels and duration for each task
        tasks = tasks.map(task => {
            const parsed = parseTaskLabelsAndDuration(task, allLabels);
            return {
                ...task,
                labels: parsed.labels,
                parsedDuration: parsed.duration
            };
        });

        renderTasks();
        
        // Load statistics in the background after successfully loading tasks
        // This ensures the data is ready when the user first switches to the statistics tab
        loadStatisticsInBackground();
        
    } catch (error) {
        console.error('Error loading tasks:', error);
        document.getElementById('task-list').innerHTML = 
            '<div class="error"><p>Error loading tasks. Please check your token and try again.</p></div>';
    }
}

// Function to load statistics data in the background without affecting the UI
async function loadStatisticsInBackground() {
    try {
        // Fetch fresh completed tasks data and cache it
        completedTasksCache = await fetchCompletedTasksFromTodoist();
    } catch (error) {
        console.error('Error loading statistics in background:', error);
        // If background loading fails, we'll just fall back to the existing behavior
        // where the user needs to click refresh when switching to stats tab
    }
}

function renderTasks() {
    const taskList = document.getElementById('task-list');
    
    if (tasks.length === 0) {
        taskList.innerHTML = '<div class="loading"><p>No tasks scheduled for today</p></div>';
        return;
    }

    taskList.innerHTML = tasks.map(task => {
        return `
            <div class="task-item ${timerState.currentTask === task.id ? 'selected' : ''}" onclick="selectTask('${task.id}')">
                <div class="task-content">
                    <div class="task-title">${task.content}</div>
                    <div class="task-tags">
                        ${task.labels.map(label => `<span class="task-tag">${label}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function selectTask(taskId) {
    if (timerState.isRunning) {
        return; // Don't allow changing tasks while timer is running
    }
    
    timerState.currentTask = taskId;
    
    // Update task visual selection
    document.querySelectorAll('.task-item').forEach(item => {
        item.classList.remove('selected');
    });
    document.querySelector(`[onclick="selectTask('${taskId}')"]`).classList.add('selected');
    
    // Update tab title
    updateTabTitle();

    const taskName = tasks.find(t => t.id === taskId)?.content || 'Unknown Task';
    document.getElementById('selected-task').textContent = taskName;
}

// Timer functionality
function startTimer() {
    if (!timerState.currentTask) {
        return; // Do nothing if no task selected
    }

    timerState.isRunning = true;
    timerState.isPaused = false;
    timerState.startTime = new Date();
    timerState.actualStartTime = Date.now(); // Track actual start time for precise timing
    timerState.pausedTime = 0; // Reset paused time
    
    // Set due_datetime if not already set (first time working on this task)
    setTaskStartTime(timerState.currentTask);
    
    currentTimer = setInterval(updateTimer, 1000);
    updateTimerControls();
    updateTabTitle();
}

function stopTimer() {
    if (!timerState.isRunning) return;
    
    clearInterval(currentTimer);
    currentTimer = null;
    
    const endTime = new Date();
    const sessionDuration = Math.round((endTime - timerState.startTime) / 1000 / 60); // minutes
    
    // Update task duration in Todoist
    const task = tasks.find(t => t.id === timerState.currentTask);
    if (task) {
        updateTaskDuration(task.id, sessionDuration);
    }
    
    // Reset timer state
    timerState.isRunning = false;
    timerState.isPaused = false;
    timerState.remaining = timerState.duration;
    timerState.startTime = null;
    timerState.actualStartTime = null;
    timerState.pausedTime = 0;
    delete timerState.pauseStartTime;
    
    updateTimerDisplay();
    updateTimerControls();
    updateTabTitle();
}

function cancelTimer() {
    if (!timerState.isRunning) return;
    
    clearInterval(currentTimer);
    currentTimer = null;
    
    // Reset timer state without recording any session data
    timerState.isRunning = false;
    timerState.isPaused = false;
    timerState.remaining = timerState.duration;
    timerState.startTime = null;
    timerState.actualStartTime = null;
    timerState.pausedTime = 0;
    delete timerState.pauseStartTime;
    
    updateTimerDisplay();
    updateTimerControls();
    updateTabTitle();
}

function pauseTimer() {
    if (!timerState.isRunning || timerState.isPaused) return;
    
    clearInterval(currentTimer);
    currentTimer = null;
    timerState.isPaused = true;
    timerState.pauseStartTime = Date.now(); // Track when pause started
    
    updateTimerControls();
    updateTabTitle();
}

function resumeTimer() {
    if (!timerState.isPaused) return;
    
    // Add the paused duration to total paused time
    if (timerState.pauseStartTime) {
        timerState.pausedTime += Date.now() - timerState.pauseStartTime;
    }
    
    timerState.isPaused = false;
    delete timerState.pauseStartTime;
    currentTimer = setInterval(updateTimer, 1000);
    
    updateTimerControls();
    updateTabTitle();
}

function addTime() {
    timerState.remaining += 25 * 60; // Add 25 minutes
    timerState.duration += 25 * 60;
    
    updateTimerDisplay();
}

function resetTimer() {
    if (timerState.isRunning) return; // Don't allow reset while running
    
    timerState.remaining = settings.diamondDuration * 60;
    timerState.duration = settings.diamondDuration * 60;
    timerState.actualStartTime = null;
    timerState.pausedTime = 0;
    delete timerState.pauseStartTime;
    
    updateTimerDisplay();
}

function updateTimer() {
    if (!timerState.actualStartTime) return;
    
    // Calculate actual elapsed time
    const now = Date.now();
    let elapsedTime = now - timerState.actualStartTime;
    
    // Subtract paused time
    elapsedTime -= timerState.pausedTime;
    
    // If currently paused, subtract current pause duration
    if (timerState.isPaused && timerState.pauseStartTime) {
        elapsedTime -= (now - timerState.pauseStartTime);
    }
    
    // Convert to seconds
    const elapsedSeconds = Math.floor(elapsedTime / 1000);
    
    // Update remaining time based on actual elapsed time
    timerState.remaining = Math.max(0, timerState.duration - elapsedSeconds);
    
    updateTimerDisplay();
    
    // Check if timer completed
    if (timerState.remaining <= 0) {
        stopTimer();
        playNotificationSound();
    }
}

function updateTimerDisplay() {
    const minutes = Math.floor(timerState.remaining / 60);
    const seconds = timerState.remaining % 60;
    document.getElementById('timer-display').textContent = 
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    updateTabTitle();
}

function updateTimerControls() {
    const controls = document.getElementById('timer-controls');
    
    if (!timerState.isRunning) {
        // Timer is inactive
        controls.innerHTML = `
            <button class="timer-btn start" onclick="startTimer()" id="start-btn">▶️ Start</button>
            <button class="timer-btn add" onclick="addTime()" id="add-btn">+25</button>
            <button class="timer-btn reset" onclick="resetTimer()" id="reset-btn">🔄 Reset</button>
        `;
    } else if (timerState.isPaused) {
        // Timer is paused
        controls.innerHTML = `
            <button class="timer-btn start" onclick="resumeTimer()">▶️ Resume</button>
            <button class="timer-btn stop" onclick="stopTimer()">⏹️ Stop</button>
            <button class="timer-btn cancel" onclick="cancelTimer()">❌ Cancel</button>
            <button class="timer-btn add" onclick="addTime()" id="add-btn">+25</button>
        `;
    } else {
        // Timer is running
        controls.innerHTML = `
            <button class="timer-btn pause" onclick="pauseTimer()">⏸️ Pause</button>
            <button class="timer-btn stop" onclick="stopTimer()">⏹️ Stop</button>
            <button class="timer-btn cancel" onclick="cancelTimer()">❌ Cancel</button>
            <button class="timer-btn add" onclick="addTime()" id="add-btn">+25</button>
        `;
    }
}

// Todoist integration with native time tracking
async function setTaskStartTime(taskId) {
    if (!todoistToken) return;
    
    try {
        // Get current task to check if it already has due_datetime
        const taskResponse = await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}`, {
            headers: {
                'Authorization': `Bearer ${todoistToken}`
            }
        });
        
        if (!taskResponse.ok) return;
        
        const task = await taskResponse.json();
        
        // Only set due_datetime if it's not already set
        if (!task.due || !task.due.datetime) {
            const now = new Date();
            const dueDatetime = now.toISOString();
            
            await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${todoistToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    due_datetime: dueDatetime
                })
            });
        }
    } catch (error) {
        console.error('Error setting task start time:', error);
    }
}

async function updateTaskDuration(taskId, sessionDurationMinutes) {
    if (!todoistToken) return;
    
    try {
        // Get current task to check existing duration
        const taskResponse = await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}`, {
            headers: {
                'Authorization': `Bearer ${todoistToken}`
            }
        });
        
        if (!taskResponse.ok) return;
        
        const task = await taskResponse.json();
        
        // Calculate new duration
        let currentDuration = 0;
        if (task.duration && task.duration.amount) {
            // Convert existing duration to minutes
            if (task.duration.unit === 'minute') {
                currentDuration = task.duration.amount;
            } else if (task.duration.unit === 'hour') {
                currentDuration = task.duration.amount * 60;
            }
        }
        
        const newDurationMinutes = currentDuration + sessionDurationMinutes;
        
        // Update task with new duration
        await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${todoistToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                duration: newDurationMinutes,
                duration_unit: 'minute'
            })
        });
        
        // Reload tasks to show updated duration
        loadTasks();
        
    } catch (error) {
        console.error('Error updating task duration:', error);
    }
}

// Statistics - now based on cached data to avoid repeated API calls
async function loadStatisticsData() {
    if (!todoistToken) {
        showNoData();
        return;
    }

    try {
        // Show loading state in individual chart containers
        const loadingMessage = '<div class="loading"><p>Loading...</p></div>';
        document.getElementById('day-chart').innerHTML = loadingMessage;
        document.getElementById('week-total-chart').innerHTML = loadingMessage;
        document.getElementById('wweek-total-chart').innerHTML = loadingMessage;
        document.getElementById('month-chart').innerHTML = loadingMessage;

        // Fetch fresh completed tasks data
        completedTasksCache = await fetchCompletedTasksFromTodoist();
        
        // Render current period with cached data
        updateStatistics();
        
    } catch (error) {
        console.error('Error loading statistics:', error);
        showNoData();
    }
}

function refreshStatistics() {
    // Clear caches to ensure fresh data
    completedTasksCache = null;
    labelsCache = null;
    
    // Explicitly refresh the statistics data
    loadStatisticsData();
}

// Function to refresh today's tasks
function refreshTodayTasks() {
    if (!todoistToken) {
        document.getElementById('task-list').innerHTML = 
            '<div class="loading"><p>Please add your Todoist token in settings</p></div>';
        return;
    }
    
    // Show loading state immediately
    document.getElementById('task-list').innerHTML = 
        '<div class="loading"><p>🔄 Refreshing today\'s tasks...</p></div>';
    
    // Clear any existing task selection
    timerState.currentTask = null;
    
    // Reload tasks
    loadTasks();
}

// Contextual refresh function that adapts based on current tab
function contextualRefresh() {
    // Check which tab is currently active
    const trackerTab = document.getElementById('tracker-tab');
    const goalsTab = document.getElementById('goals-tab');
    const statsTab = document.getElementById('stats-tab');
    
    if (trackerTab.classList.contains('active')) {
        // We're on the tracker tab, refresh today's tasks
        refreshTodayTasks();
    } else if (goalsTab && goalsTab.classList.contains('active')) {
        // We're on the goals tab, force refresh goals
        loadGoals(true);
    } else if (statsTab.classList.contains('active')) {
        // We're on the statistics tab, refresh statistics
        refreshStatistics();
    }
}

function showNoDataWithRefreshPrompt() {
    if (!todoistToken) {
        showNoData();
        return;
    }
    
    // Show a message prompting to refresh
    const chartContainers = ['day-chart', 'week-total-chart', 'wweek-total-chart', 'month-chart'];
    chartContainers.forEach(id => {
        document.getElementById(id).innerHTML = '<div class="loading"><p>Click 🔄 to load statistics</p></div>';
    });
    
    document.getElementById('daily-charts-container').innerHTML = '';
    document.getElementById('wweek-daily-charts-container').innerHTML = '';
}

function updateStatistics() {
    if (!completedTasksCache) {
        showNoDataWithRefreshPrompt();
        return;
    }

    try {
        const defaultTime = settings.defaultTaskTime || 25;
        
        if (completedTasksCache.length === 0) {
            showNoData();
            return;
        }

        hideNoData();

        // Render charts based on current period using cached data
        switch (currentPeriod) {
            case 'day':
                renderDayChart(completedTasksCache, defaultTime);
                break;
            case 'week':
                renderWeekChart(completedTasksCache, defaultTime);
                break;
            case 'wweek':
                renderWWeekChart(completedTasksCache, defaultTime);
                break;
            case 'month':
                renderMonthChart(completedTasksCache, defaultTime);
                break;
        }
        
    } catch (error) {
        console.error('Error updating statistics:', error);
        showNoData();
    }
}

async function fetchCompletedTasksFromTodoist() {
    let completedTasks = [];
    
    try {
        // Fetch labels first for proper parsing
        const allLabels = await fetchLabelsFromTodoist();
        
        // Use sync API to get completed tasks (main approach)
        const completedResponse = await fetch('https://api.todoist.com/sync/v9/completed/get_all', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${todoistToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        
        if (completedResponse.ok) {
            const completedData = await completedResponse.json();
            const rawCompletedTasks = completedData.items || [];
            
            // Fetch detailed task information for each completed task to get proper labels and durations
            const detailedTasks = await Promise.all(
                rawCompletedTasks.slice(0, 100).map(async (task) => { // Limit to 100 most recent to avoid API limits
                    try {
                        // Try to fetch full task details from REST API
                        const taskDetailResponse = await fetch(`https://api.todoist.com/rest/v2/tasks/${task.task_id || task.id}`, {
                            headers: {
                                'Authorization': `Bearer ${todoistToken}`
                            }
                        });
                        
                        if (taskDetailResponse.ok) {
                            const taskDetail = await taskDetailResponse.json();
                            // Merge completed task info with detailed task info
                            return {
                                ...task,
                                ...taskDetail,
                                completed_at: task.completed_at || task.completed_date,
                                // Preserve sync API specific fields
                                task_id: task.task_id || task.id
                            };
                        }
                    } catch (e) {
                        // Swallow detail fetch failure; we'll fallback to sync data
                    }
                    
                    // Fallback to sync API data if REST API fails
                    return task;
                })
            );
            
            // Process completed tasks with enhanced label and duration parsing
            completedTasks = detailedTasks.map(task => {
                const parsed = parseTaskLabelsAndDuration(task, allLabels);
                
                // Create processed task with consistent format
                const processedTask = {
                    ...task,
                    labels: parsed.labels,
                    parsedDuration: parsed.duration,
                    completed_at: task.completed_at || task.completed_date // Handle different date formats
                };
                
                return processedTask;
            });
        }
        
    } catch (error) {
        console.error('Error fetching completed tasks:', error);
    }
    
    return completedTasks;
}

function renderDayChart(completedTasks, defaultTime) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Filter tasks completed today
    const todayTasks = completedTasks.filter(task => {
        const completedDate = new Date(task.completed_at);
        return completedDate >= today && completedDate < tomorrow;
    });

    const tagStats = groupTasksByTags(todayTasks, defaultTime);
    const total = Object.values(tagStats).reduce((sum, val) => sum + val, 0);
    
    // Update the h3 title
    const dayView = document.getElementById('day-view');
    const h3 = dayView.querySelector('h3');
    h3.textContent = `Today's Completed Tasks (${formatTime(total)})`;
    
    renderBarChart('day-chart', { 'Today': tagStats });
}

function renderWeekChart(completedTasks, defaultTime) {
    // Last 7 days ending with today
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6); // 6 days ago + today = 7 days
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Filter tasks completed in last 7 days
    const weekTasks = completedTasks.filter(task => {
        const completedDate = new Date(task.completed_at);
        return completedDate >= sevenDaysAgo && completedDate <= today;
    });

    // Total week stats
    const weekTagStats = groupTasksByTags(weekTasks, defaultTime);
    const total = Object.values(weekTagStats).reduce((sum, val) => sum + val, 0);
    
    // Update the h3 title
    const weekView = document.getElementById('week-view');
    const h3 = weekView.querySelector('h3');
    h3.textContent = `Last 7 Days Completed Tasks (${formatTime(total)})`;
    
    renderBarChart('week-total-chart', { 'Week': weekTagStats });

    // Daily breakdown
    renderDailyCharts(weekTasks, sevenDaysAgo, defaultTime, 'daily-charts-container');
}

function renderWWeekChart(completedTasks, defaultTime) {
    // Working week: Monday to Sunday with today somewhere inside
    const today = new Date();
    
    // Find Monday of current week
    const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysFromMonday = (currentDay === 0) ? 6 : currentDay - 1; // If Sunday, go back 6 days
    
    const startOfWorkWeek = new Date(today);
    startOfWorkWeek.setDate(today.getDate() - daysFromMonday);
    startOfWorkWeek.setHours(0, 0, 0, 0);
    
    const endOfWorkWeek = new Date(startOfWorkWeek);
    endOfWorkWeek.setDate(startOfWorkWeek.getDate() + 6); // Monday + 6 days = Sunday
    endOfWorkWeek.setHours(23, 59, 59, 999);

    // Filter tasks completed in current working week
    const wweekTasks = completedTasks.filter(task => {
        const completedDate = new Date(task.completed_at);
        return completedDate >= startOfWorkWeek && completedDate <= endOfWorkWeek;
    });

    // Total working week stats
    const wweekTagStats = groupTasksByTags(wweekTasks, defaultTime);
    const total = Object.values(wweekTagStats).reduce((sum, val) => sum + val, 0);
    
    // Update the h3 title
    const wweekView = document.getElementById('wweek-view');
    const h3 = wweekView.querySelector('h3');
    h3.textContent = `This Working Week's Completed Tasks (${formatTime(total)})`;
    
    renderBarChart('wweek-total-chart', { 'Working Week': wweekTagStats });

    // Daily breakdown for working week
    renderWorkingWeekDailyCharts(wweekTasks, startOfWorkWeek, defaultTime);
}

function renderMonthChart(completedTasks, defaultTime) {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    // Filter tasks completed this month
    const monthTasks = completedTasks.filter(task => {
        const completedDate = new Date(task.completed_at);
        return completedDate >= startOfMonth && completedDate < endOfMonth;
    });

    const monthTagStats = groupTasksByTags(monthTasks, defaultTime);
    const total = Object.values(monthTagStats).reduce((sum, val) => sum + val, 0);
    
    // Update the h3 title
    const monthView = document.getElementById('month-view');
    const h3 = monthView.querySelector('h3');
    h3.textContent = `This Month's Completed Tasks (${formatTime(total)})`;
    
    renderBarChart('month-chart', { 'Month': monthTagStats });
}

function groupTasksByTags(tasks, defaultTime) {
    const tagStats = {};
    
    tasks.forEach(task => {
        const duration = getTaskDuration(task, defaultTime);
        let tags = task.labels || [];
        
        // Ensure we have an array and it's not empty
        if (!Array.isArray(tags)) {
            tags = [];
        }
        
        // If no tags, use "Untagged"
        if (tags.length === 0) {
            tags = ['Untagged'];
        }
        
        // Split duration equally among all tags
        const durationPerTag = duration / tags.length;
        
        tags.forEach(tag => {
            if (!tagStats[tag]) {
                tagStats[tag] = 0;
            }
            tagStats[tag] += durationPerTag;
        });
    });
    
    return tagStats;
}

function getTaskDuration(task, defaultTime) {
    // First check for our parsed duration
    if (task.parsedDuration && typeof task.parsedDuration === 'number' && task.parsedDuration > 0) {
        return task.parsedDuration;
    }
    
    // Fallback to original duration parsing for compatibility
    if (task.duration && task.duration.amount) {
        if (task.duration.unit === 'minute') {
            return task.duration.amount;
        } else if (task.duration.unit === 'hour') {
            return task.duration.amount * 60;
        }
    }
    
    return defaultTime;
}

function renderBarChart(containerId, data) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const allTags = new Set();
    Object.values(data).forEach(tagStats => {
        Object.keys(tagStats).forEach(tag => allTags.add(tag));
    });
    
    if (allTags.size === 0) return;

    const tagArray = Array.from(allTags).sort();

    // Find the maximum total to normalize bar heights
    const maxTotal = Math.max(...Object.values(data).map(tagStats => 
        Object.values(tagStats).reduce((sum, val) => sum + val, 0)
    ));

    Object.entries(data).forEach(([period, tagStats]) => {
        const total = Object.values(tagStats).reduce((sum, val) => sum + val, 0);

        // Create container for bar and tags
        const chartBarContainer = document.createElement('div');
        chartBarContainer.className = 'chart-bar-container';

        // Create the bar with normalized height
        const chartBar = document.createElement('div');
        chartBar.className = 'chart-bar';
        
        // Calculate total height based on proportion of max total (max 200px)
        const totalHeight = maxTotal > 0 ? (total / maxTotal) * 200 : 0;
        chartBar.style.height = `${totalHeight}px`;

        // Create segments for the vertical bar (bottom to top)
        const sortedTags = tagArray.filter(tag => tagStats[tag] > 0);
        
        sortedTags.forEach(tag => {
            const value = tagStats[tag];
            const segmentHeight = (value / total) * totalHeight; // Height based on proportion of this bar's total
            const segment = document.createElement('div');
            segment.className = 'bar-segment';
            segment.style.height = `${segmentHeight}px`;
            segment.style.backgroundColor = getTagColor(tag);
            chartBar.appendChild(segment);
        });

        // Add total value label on top
        const value = document.createElement('div');
        value.className = 'bar-value';
        value.textContent = formatTime(total);
        chartBar.appendChild(value);

        // Create tags container
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'chart-tags';
        
        // Create tag items
        sortedTags.forEach(tag => {
            const value = tagStats[tag];
            
            const tagItem = document.createElement('div');
            tagItem.className = 'chart-tag-item';
            
            const colorBox = document.createElement('div');
            colorBox.className = 'chart-tag-color';
            colorBox.style.backgroundColor = getTagColor(tag);
            
            const tagName = document.createElement('span');
            tagName.className = 'chart-tag-name';
            tagName.textContent = tag;
            
            const tagValue = document.createElement('span');
            tagValue.className = 'chart-tag-value';
            tagValue.textContent = formatTime(value);
            
            tagItem.appendChild(colorBox);
            tagItem.appendChild(tagName);
            tagItem.appendChild(tagValue);
            
            tagsContainer.appendChild(tagItem);
        });

        // Add bar and tags to container
        chartBarContainer.appendChild(chartBar);
        chartBarContainer.appendChild(tagsContainer);
        
        container.appendChild(chartBarContainer);
    });
}

function renderDailyCharts(weekTasks, startOfWeek, defaultTime, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const dailyRow = document.createElement('div');
    dailyRow.className = 'daily-chart-row';

    // For last 7 days, show actual dates
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(startOfWeek);
        dayDate.setDate(startOfWeek.getDate() + i);
        const nextDay = new Date(dayDate);
        nextDay.setDate(dayDate.getDate() + 1);

        const dayTasks = weekTasks.filter(task => {
            const completedDate = new Date(task.completed_at);
            return completedDate >= dayDate && completedDate < nextDay;
        });

        const dayChart = document.createElement('div');
        dayChart.className = 'daily-chart';

        const title = document.createElement('div');
        title.className = 'daily-chart-title';
        // Show actual date for last 7 days view
        title.textContent = `${dayDate.getMonth() + 1}/${dayDate.getDate()}`;

        const bar = document.createElement('div');
        bar.className = 'daily-bar';

        const tagStats = groupTasksByTags(dayTasks, defaultTime);
        const total = Object.values(tagStats).reduce((sum, val) => sum + val, 0);
        
        if (total > 0) {
            const maxHeight = 160;
            Object.entries(tagStats).forEach(([tag, value]) => {
                const segmentHeight = (value / total) * maxHeight;
                const segment = document.createElement('div');
                segment.className = 'daily-bar-segment';
                segment.style.height = `${segmentHeight}px`;
                segment.style.backgroundColor = getTagColor(tag);
                bar.appendChild(segment);
            });

            const valueLabel = document.createElement('div');
            valueLabel.className = 'daily-bar-value';
            valueLabel.textContent = formatTime(total);
            bar.appendChild(valueLabel);
        }

        dayChart.appendChild(title);
        dayChart.appendChild(bar);
        dailyRow.appendChild(dayChart);
    }

    container.appendChild(dailyRow);
}

function renderWorkingWeekDailyCharts(wweekTasks, startOfWorkWeek, defaultTime) {
    const container = document.getElementById('wweek-daily-charts-container');
    container.innerHTML = '';

    const dailyRow = document.createElement('div');
    dailyRow.className = 'daily-chart-row';

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(startOfWorkWeek);
        dayDate.setDate(startOfWorkWeek.getDate() + i);
        const nextDay = new Date(dayDate);
        nextDay.setDate(dayDate.getDate() + 1);

        const dayTasks = wweekTasks.filter(task => {
            const completedDate = new Date(task.completed_at);
            return completedDate >= dayDate && completedDate < nextDay;
        });

        const dayChart = document.createElement('div');
        dayChart.className = 'daily-chart';

        const title = document.createElement('div');
        title.className = 'daily-chart-title';
        title.textContent = days[i];

        const bar = document.createElement('div');
        bar.className = 'daily-bar';

        const tagStats = groupTasksByTags(dayTasks, defaultTime);
        const total = Object.values(tagStats).reduce((sum, val) => sum + val, 0);
        
        if (total > 0) {
            const maxHeight = 160;
            Object.entries(tagStats).forEach(([tag, value]) => {
                const segmentHeight = (value / total) * maxHeight;
                const segment = document.createElement('div');
                segment.className = 'daily-bar-segment';
                segment.style.height = `${segmentHeight}px`;
                segment.style.backgroundColor = getTagColor(tag);
                bar.appendChild(segment);
            });

            const valueLabel = document.createElement('div');
            valueLabel.className = 'daily-bar-value';
            valueLabel.textContent = formatTime(total);
            bar.appendChild(valueLabel);
        }

        dayChart.appendChild(title);
        dayChart.appendChild(bar);
        dailyRow.appendChild(dayChart);
    }

    container.appendChild(dailyRow);
}

function showNoData() {
    document.getElementById('no-data').style.display = 'block';
    document.querySelectorAll('.chart-view').forEach(view => {
        view.style.display = 'none';
    });
}

function hideNoData() {
    document.getElementById('no-data').style.display = 'none';
    // Show current period view
    document.querySelectorAll('.chart-view').forEach(view => {
        view.style.display = 'none';
    });
    document.getElementById(`${currentPeriod}-view`).style.display = 'block';
}

function getTagColor(tag) {
    // Modern color palette with vibrant, distinct colors
    const modernColors = [
        '#277da1',  // cerulean
        '#4d908e', // dark-cyan
        '#43aa8b', // zomp
        '#90be6d', // pistachio
        '#f9c74f', // saffron
        '#f9844a', // coral
        '#f3722c', // orange-crayola
        '#f94144', // imperial-red        
    ];
    
    // Check if this tag already has a color assigned
    if (tagColorAssignments[tag] !== undefined) {
        return modernColors[tagColorAssignments[tag]];
    }
    
    // Assign the next sequential color to this new tag
    const colorIndex = nextColorIndex % modernColors.length;
    tagColorAssignments[tag] = colorIndex;
    nextColorIndex++;
    
    return modernColors[colorIndex];
}

function changePeriod(period) {
    currentPeriod = period;
    
    // Update period buttons
    document.querySelectorAll('.period-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[onclick="changePeriod('${period}')"]`).classList.add('active');
    
    // Update view
    document.querySelectorAll('.chart-view').forEach(view => {
        view.classList.remove('active');
    });
    document.getElementById(`${period}-view`).classList.add('active');
    
    // Use cached data instead of making new API call
    updateStatistics();
}

// Utility functions
function formatTime(minutes) {
    if (minutes < 60) {
        return `${Math.round(minutes)}m`;
    } else {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = Math.round(minutes % 60);
        if (remainingMinutes === 0) {
            return `${hours}h`;
        } else {
            return `${hours}h ${remainingMinutes}m`;
        }
    }
}

function playNotificationSound() {
    // Create a simple beep sound using Web Audio API
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
        // Audio notification not available in this environment
    }
}

// Close modal when clicking outside
document.getElementById('settings-modal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeSettings();
    }
});

// Bitcoin donation functionality
function copyBitcoinAddress() {
    const btcAddress = 'bc1qd99znkchpq464a26t0dpzevcks9xk2ucexpu7m';
    const bitcoinIcon = document.querySelector('.bitcoin-donate svg');
    
    // Copy to clipboard
    navigator.clipboard.writeText(btcAddress).then(function() {
        // Change to clipboard icon on success
        bitcoinIcon.innerHTML = '<g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path opacity="0.4" d="M22 11.1V6.9C22 3.4 20.6 2 17.1 2H12.9C9.4 2 8 3.4 8 6.9V8H11.1C14.6 8 16 9.4 16 12.9V16H17.1C20.6 16 22 14.6 22 11.1Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M16 17.1V12.9C16 9.4 14.6 8 11.1 8H6.9C3.4 8 2 9.4 2 12.9V17.1C2 20.6 3.4 22 6.9 22H11.1C14.6 22 16 20.6 16 17.1Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M6.08008 14.9998L8.03008 16.9498L11.9201 13.0498" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </g>';
        bitcoinIcon.setAttribute('viewBox', '0 0 24 24');
        bitcoinIcon.setAttribute('fill', 'none');
        
        // Revert to bitcoin icon after 2 seconds
        setTimeout(() => {
            bitcoinIcon.innerHTML = '<path d="M310.2 242.6c27.7-14.2 45.4-39.4 41.3-81.3-5.4-57.4-52.5-76.6-114.9-81.9V0h-48.5v77.2c-12.6 0-25.5 .3-38.4 .6V0h-48.5v79.4c-17.8 .5-38.6 .3-97.4 0v51.7c38.3-.7 58.4-3.1 63 21.4v217.4c-2.9 19.5-18.5 16.7-53.3 16.1L3.8 443.7c88.5 0 97.4 .3 97.4 .3V512h48.5v-67.1c13.2 .3 26.2 .3 38.4 .3V512h48.5v-68c81.3-4.4 135.6-24.9 142.9-101.5 5.7-61.4-23.3-88.9-69.3-99.9zM150.6 134.6c27.4 0 113.1-8.5 113.1 48.5 0 54.5-85.7 48.2-113.1 48.2v-96.7zm0 251.8V279.8c32.8 0 133.1-9.1 133.1 53.3 0 60.2-100.4 53.3-133.1 53.3z"/>';
            bitcoinIcon.setAttribute('viewBox', '0 0 512 512');
            bitcoinIcon.setAttribute('fill', 'currentColor');
        }, 2000);
    }).catch(function(err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = btcAddress;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        // Change to clipboard icon on success (fallback)
        bitcoinIcon.innerHTML = '<g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path opacity="0.4" d="M22 11.1V6.9C22 3.4 20.6 2 17.1 2H12.9C9.4 2 8 3.4 8 6.9V8H11.1C14.6 8 16 9.4 16 12.9V16H17.1C20.6 16 22 14.6 22 11.1Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M16 17.1V12.9C16 9.4 14.6 8 11.1 8H6.9C3.4 8 2 9.4 2 12.9V17.1C2 20.6 3.4 22 6.9 22H11.1C14.6 22 16 20.6 16 17.1Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M6.08008 14.9998L8.03008 16.9498L11.9201 13.0498" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </g>';
        bitcoinIcon.setAttribute('viewBox', '0 0 24 24');
        bitcoinIcon.setAttribute('fill', 'none');
        
        // Revert to bitcoin icon after 2 seconds
        setTimeout(() => {
            bitcoinIcon.innerHTML = '<path d="M310.2 242.6c27.7-14.2 45.4-39.4 41.3-81.3-5.4-57.4-52.5-76.6-114.9-81.9V0h-48.5v77.2c-12.6 0-25.5 .3-38.4 .6V0h-48.5v79.4c-17.8 .5-38.6 .3-97.4 0v51.7c38.3-.7 58.4-3.1 63 21.4v217.4c-2.9 19.5-18.5 16.7-53.3 16.1L3.8 443.7c88.5 0 97.4 .3 97.4 .3V512h48.5v-67.1c13.2 .3 26.2 .3 38.4 .3V512h48.5v-68c81.3-4.4 135.6-24.9 142.9-101.5 5.7-61.4-23.3-88.9-69.3-99.9zM150.6 134.6c27.4 0 113.1-8.5 113.1 48.5 0 54.5-85.7 48.2-113.1 48.2v-96.7zm0 251.8V279.8c32.8 0 133.1-9.1 133.1 53.3 0 60.2-100.4 53.3-133.1 53.3z"/>';
            bitcoinIcon.setAttribute('viewBox', '0 0 512 512');
            bitcoinIcon.setAttribute('fill', 'currentColor');
        }, 2000);
    });
} 

// =====================
// Goals (single service task comment storage)
// =====================

async function getInboxProjectId() {
    if (!todoistToken) return null;
    try {
        const resp = await fetch('https://api.todoist.com/rest/v2/projects', {
            headers: { 'Authorization': `Bearer ${todoistToken}` }
        });
        if (!resp.ok) return null;
        const projects = await resp.json();
        const inbox = projects.find(p => p.is_inbox_project === true);
        return inbox ? inbox.id : null;
    } catch (e) {
        console.error('Error fetching Inbox project id:', e);
        return null;
    }
}

async function getOrCreateServiceTaskId() {
    if (!todoistToken) return null;

    // Validate cached id
    if (serviceTaskIdCache) {
        try {
            const check = await fetch(`https://api.todoist.com/rest/v2/tasks/${serviceTaskIdCache}`, {
                headers: { 'Authorization': `Bearer ${todoistToken}` }
            });
            if (check.ok) {
                return serviceTaskIdCache;
            }
        } catch (e) {
            // fall through
        }
        serviceTaskIdCache = null;
        localStorage.removeItem('deloist_service_task_id');
    }

    // Find by name in Inbox
    try {
        const inboxId = await getInboxProjectId();
        if (!inboxId) return null;
        const list = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${inboxId}`, {
            headers: { 'Authorization': `Bearer ${todoistToken}` }
        });
        if (list.ok) {
            const tasksResp = await list.json();
            const found = tasksResp.find(t => t.content === SERVICE_TASK_NAME && (!Array.isArray(t.labels) || t.labels.length === 0));
            if (found) {
                serviceTaskIdCache = found.id;
                localStorage.setItem('deloist_service_task_id', serviceTaskIdCache);
                return serviceTaskIdCache;
            }
        }
        // Create new in Inbox
        const create = await fetch('https://api.todoist.com/rest/v2/tasks', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${todoistToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ project_id: inboxId, content: SERVICE_TASK_NAME })
        });
        if (create.ok) {
            const created = await create.json();
            serviceTaskIdCache = created.id;
            localStorage.setItem('deloist_service_task_id', serviceTaskIdCache);
            // Ensure there is an initial comment
            await ensureGoalsCommentExists(serviceTaskIdCache);
            return serviceTaskIdCache;
        }
    } catch (e) {
        console.error('Error getting/creating service task:', e);
    }
    return null;
}

async function ensureGoalsCommentExists(taskId) {
    try {
        const { commentId } = await fetchGoalsDocInternal(taskId);
        if (!commentId) {
            const payload = buildGoalsComment({ version: 1, goals: {} });
            const resp = await fetch('https://api.todoist.com/rest/v2/comments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${todoistToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ task_id: taskId, content: payload })
            });
            if (resp.ok) {
                const c = await resp.json();
                goalsDocCommentIdCache = c.id;
            }
        }
    } catch (e) {
        console.error('Error ensuring goals comment exists:', e);
    }
}

function buildGoalsComment(doc) {
    // Wrap JSON in code fences to keep Todoist markdown from mangling it
    return GOALS_DOC_MARKER + '\n```json\n' + JSON.stringify(doc) + '\n```';
}

// (Deprecated helpers removed after switching to fenced JSON storage)

async function fetchGoalsDocInternal(taskId) {
    try {
        const resp = await fetch(`https://api.todoist.com/rest/v2/comments?task_id=${taskId}`, {
            headers: { 'Authorization': `Bearer ${todoistToken}` }
        });
        if (!resp.ok) return { doc: null, commentId: null };
        const comments = await resp.json();
        // Find a comment that contains the marker (allow leading BOM/whitespace or any prefix)
        let matchedComment = null;
        let extractedJson = null;
        for (const c of comments) {
            if (!c || typeof c.content !== 'string') continue;
            const raw = c.content.replace(/^\uFEFF/, ''); // strip BOM if any
            const idx = raw.indexOf(GOALS_DOC_MARKER);
            if (idx === -1) continue;
            // Remember this comment as the storage comment even if it doesn't yet have a fenced block
            matchedComment = c;
            const afterMarker = raw.slice(idx + GOALS_DOC_MARKER.length);
            // Prefer a fenced code block right after the marker
            const fenceMatch = afterMarker.match(/```(?:json)?\n([\s\S]*?)```/);
            if (fenceMatch && fenceMatch[1]) {
                extractedJson = fenceMatch[1];
            }
            // Continue to check other comments; if none has a fenced block, we'll still return this commentId
        }
        if (!matchedComment) return { doc: null, commentId: null };
        if (!extractedJson) {
            // No fenced JSON found yet, return comment id so future save updates it in place
            return { doc: null, commentId: matchedComment.id };
        }
        try {
            const parsed = JSON.parse(extractedJson);
            return { doc: parsed, commentId: matchedComment.id };
        } catch (e) {
            console.error('Failed to parse goals JSON from comment:', e);
            return { doc: null, commentId: matchedComment.id };
        }
    } catch (e) {
        console.error('Error fetching goals doc:', e);
        return { doc: null, commentId: null };
    }
}

async function fetchGoalsDoc() {
    const taskId = await getOrCreateServiceTaskId();
    if (!taskId) return { doc: { version: 1, goals: {} }, commentId: null };
    const result = await fetchGoalsDocInternal(taskId);
    if (!result.commentId) {
        await ensureGoalsCommentExists(taskId);
        return await fetchGoalsDocInternal(taskId);
    }
    // If parsing failed but we have previous cache, return cached doc to avoid wiping UI
    if (!result.doc && goalsDocCache) {
        return { doc: goalsDocCache, commentId: result.commentId };
    }
    return result;
}

async function saveGoalsDoc(doc, commentId) {
    const taskId = await getOrCreateServiceTaskId();
    if (!taskId) return null;
    const payload = buildGoalsComment(doc);
    try {
        if (commentId) {
            const resp = await fetch(`https://api.todoist.com/rest/v2/comments/${commentId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${todoistToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ content: payload })
            });
            if (resp.ok) {
                goalsCacheReady = true; // keep cache valid
                return commentId;
            }
        } else {
            const resp = await fetch('https://api.todoist.com/rest/v2/comments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${todoistToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ task_id: taskId, content: payload })
            });
            if (resp.ok) {
                const c = await resp.json();
                goalsCacheReady = true;
                return c.id;
            }
        }
    } catch (e) {
        console.error('Error saving goals doc:', e);
    }
    return null;
}

async function loadGoals(force = false) {
    const goalsList = document.getElementById('goals-list');
    if (!goalsList) return;
    if (!todoistToken) {
        goalsList.innerHTML = '<div class="loading"><p>Please add your Todoist token in settings</p></div>';
        return;
    }
    try {
        // Fast path: render from cache if allowed
        if (!force && goalsCacheReady && labelsCache && goalsDocCache) {
            renderGoals(labelsCache, goalsDocCache);
            return;
        }

        // Show loading only if we don't already have something to show
        if (!goalsCacheReady || !goalsDocCache || !labelsCache) {
            goalsList.innerHTML = '<div class="loading"><p>Loading goals...</p></div>';
        }

        const allLabels = await fetchLabelsFromTodoist();
        const { doc, commentId } = await fetchGoalsDoc();
        goalsDocCache = doc || { version: 1, goals: {} };
        goalsDocCommentIdCache = commentId || null;
        // One-time backfill: ensure each goal stores human-readable label name
        let changed = false;
        if (goalsDocCache && goalsDocCache.goals && typeof goalsDocCache.goals === 'object') {
            for (const key of Object.keys(goalsDocCache.goals)) {
                const entry = goalsDocCache.goals[key] || {};
                if (typeof entry.label !== 'string' || entry.label.trim() === '') {
                    const found = allLabels.find(l => String(l.id) === String(key));
                    if (found && found.name) {
                        goalsDocCache.goals[key] = { ...entry, label: found.name };
                        changed = true;
                    }
                }
            }
        }
        if (changed) {
            try { await saveGoalsDoc(goalsDocCache, goalsDocCommentIdCache || null); } catch (_) {}
        }
        goalsCacheReady = true;
        renderGoals(allLabels, goalsDocCache);
    } catch (e) {
        console.error('Error loading goals:', e);
        goalsList.innerHTML = '<div class="error"><p>Error loading goals.</p></div>';
    }
}

function renderGoals(allLabels, doc) {
    const container = document.getElementById('goals-list');
    if (!container) return;
    if (!Array.isArray(allLabels) || allLabels.length === 0) {
        container.innerHTML = '<div class="loading"><p>No labels found.</p></div>';
        return;
    }
    const goalsMap = (doc && doc.goals) ? doc.goals : {};
    const sorted = [...allLabels].sort((a, b) => a.name.localeCompare(b.name));
    container.innerHTML = sorted.map(label => {
        const entry = goalsMap[String(label.id)] || {};
        const text = typeof entry.text === 'string' ? entry.text : '';
        const image = typeof entry.image === 'string' ? normalizeImageUrl(entry.image) : '';
        const hidden = entry.hidden === true;
        const completed = entry.completed === true;
        const style = image ? ` style="background-image: url('${escapeHtml(image)}')"` : '';
        const goalText = text ? escapeHtml(text) : '';
        // Hidden goals should not be displayed at all in the list; render nothing
        if (hidden) return '';
        // Filter by subtab
        if (goalsSubtab === 'current' && completed) return '';
        if (goalsSubtab === 'completed' && !completed) return '';
        return `
            <div class="goal-card"${style}>
                <div class="goal-card-tags task-tags">
                    <span class="task-tag">${escapeHtml(label.name)}</span>
                </div>
                <button class="goal-edit-btn" title="Edit goal" onclick="openGoalEditor('${label.id}')">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor"/><path d="M20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>
                </button>
                <div class="goal-goal" id="goal-display-${label.id}">${goalText}</div>
                <div id="goal-editor-${label.id}" class="goal-editor" style="display:none;">
                    <textarea class="goal-text" id="goal-text-${label.id}" placeholder="Describe your goal for ${escapeHtml(label.name)}">${escapeHtml(text)}</textarea>
                    <input class="goal-image-input" id="goal-image-${label.id}" type="text" placeholder="Image URL (optional)" value="${escapeHtml(image)}" />
                    <div class="goal-actions">
                        <button class="goal-visibility-btn" id="goal-visibility-editor-${label.id}" title="Toggle visibility" onclick="toggleGoalVisibility('${label.id}', true)">
                            <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 5c-7.633 0-11 7-11 7s3.367 7 11 7 11-7 11-7-3.367-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z"/>
                            </svg>
                        </button>
                        <button class="goal-completed-btn" id="goal-completed-editor-${label.id}" title="Toggle completed" onclick="toggleGoalCompleted('${label.id}')">
                            <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>
                            </svg>
                        </button>
                        <button class="btn btn-secondary" onclick="closeGoalEditor('${label.id}')">Cancel</button>
                        <button class="btn btn-primary" onclick="saveGoal('${label.id}', true)">Save</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function openGoalEditor(labelId) {
    const editor = document.getElementById(`goal-editor-${labelId}`);
    if (editor) editor.style.display = 'block';
    // Hide display overlay to prevent it from blocking editor controls
    const display = document.getElementById(`goal-display-${labelId}`);
    if (display) display.style.display = 'none';
    // Activate visibility icon state based on current doc (editor only)
    const eyeBtn = document.getElementById(`goal-visibility-editor-${labelId}`);
    const currentHidden = !!(goalsDocCache && goalsDocCache.goals && goalsDocCache.goals[String(labelId)] && goalsDocCache.goals[String(labelId)].hidden === true);
    if (eyeBtn) {
        eyeBtn.classList.toggle('active', currentHidden);
        eyeBtn.title = currentHidden ? 'Currently hidden. Click to show' : 'Visible. Click to hide';
    }
    const compBtn = document.getElementById(`goal-completed-editor-${labelId}`);
    const currentCompleted = !!(goalsDocCache && goalsDocCache.goals && goalsDocCache.goals[String(labelId)] && goalsDocCache.goals[String(labelId)].completed === true);
    if (compBtn) {
        compBtn.classList.toggle('active', currentCompleted);
        compBtn.title = currentCompleted ? 'Marked as completed. Click to move to current' : 'In current. Click to mark as completed';
    }
}

function closeGoalEditor(labelId) {
    const editor = document.getElementById(`goal-editor-${labelId}`);
    if (editor) editor.style.display = 'none';
    // Restore goal display overlay
    const display = document.getElementById(`goal-display-${labelId}`);
    if (display) display.style.display = '';
}

async function saveGoal(labelId, closeAfterSave = false) {
    try {
        // Refresh current doc to avoid overwriting concurrent edits
        const latest = await fetchGoalsDoc();
        const currentDoc = latest.doc || { version: 1, goals: {} };
        const textarea = document.getElementById(`goal-text-${labelId}`);
        const imageInput = document.getElementById(`goal-image-${labelId}`);
        const text = textarea ? textarea.value : '';
        const image = imageInput ? normalizeImageUrl(imageInput.value) : '';
        const hidden = document.getElementById(`goal-visibility-editor-${labelId}`)?.classList.contains('active') || false;
        const completed = document.getElementById(`goal-completed-editor-${labelId}`)?.classList.contains('active') || false;
        // Include label name for convenience
        const labels = await fetchLabelsFromTodoist();
        const labelName = (labels.find(l => String(l.id) === String(labelId)) || {}).name || '';
        const obj = { text, image, label: labelName };
        if (hidden) obj.hidden = true;
        if (completed) obj.completed = true;
        currentDoc.goals[String(labelId)] = obj;
        const savedId = await saveGoalsDoc(currentDoc, latest.commentId || null);
        if (savedId) {
            goalsDocCache = currentDoc;
            goalsDocCommentIdCache = savedId;
            const display = document.getElementById(`goal-display-${labelId}`);
            if (display) display.innerHTML = (!hidden && text) ? escapeHtml(text) : '';
            const card = display.closest('.goal-card');
            if (card) {
                if (image) card.style.backgroundImage = `url('${image}')`;
                else card.style.backgroundImage = '';
            }
            // Re-render to reflect subtab movement
            if (labelsCache && goalsDocCache) {
                renderGoals(labelsCache, goalsDocCache);
            }
            if (closeAfterSave) closeGoalEditor(labelId);
        }
    } catch (e) {
        console.error('Error saving goal:', e);
    }
}

function toggleGoalVisibility(labelId) {
    const btn = document.getElementById(`goal-visibility-editor-${labelId}`);
    if (!btn) return;
    const newState = !btn.classList.contains('active');
    btn.classList.toggle('active', newState);
    btn.title = newState ? 'Currently hidden. Click to show' : 'Visible. Click to hide';
}

function toggleGoalCompleted(labelId) {
    const btn = document.getElementById(`goal-completed-editor-${labelId}`);
    if (!btn) return;
    const newState = !btn.classList.contains('active');
    btn.classList.toggle('active', newState);
    btn.title = newState ? 'Marked as completed. Click to move to current' : 'In current. Click to mark as completed';
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Remove stray leading/trailing brackets/whitespace that might appear when editing by hand
function normalizeImageUrl(url) {
    if (typeof url !== 'string') return '';
    return url.trim();
}