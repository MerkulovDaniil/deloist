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

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    loadSettings();
    updateTimerDisplay();
    if (todoistToken) {
        loadTasks();
    }
});

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
    
    if (tabName === 'stats') {
        // Use cached data if available, otherwise show no data message
        if (completedTasksCache) {
            updateStatistics();
        } else {
            showNoDataWithRefreshPrompt();
        }
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
            console.log('Fetched labels:', labelsCache);
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
    
    // Debug logging
    console.log('Parsing task:', {
        id: task.id || task.task_id,
        content: task.content,
        labels: task.labels,
        duration: task.duration
    });
    
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
    
    console.log('Parsed result:', result);
    
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
        tasks = allTasks.filter(task => task.due && task.due.date === localDateString);

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
    } catch (error) {
        console.error('Error loading tasks:', error);
        document.getElementById('task-list').innerHTML = 
            '<div class="error"><p>Error loading tasks. Please check your token and try again.</p></div>';
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
}

function pauseTimer() {
    if (!timerState.isRunning || timerState.isPaused) return;
    
    clearInterval(currentTimer);
    currentTimer = null;
    timerState.isPaused = true;
    timerState.pauseStartTime = Date.now(); // Track when pause started
    
    updateTimerControls();
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
            <button class="timer-btn add" onclick="addTime()" id="add-btn">+25</button>
        `;
    } else {
        // Timer is running
        controls.innerHTML = `
            <button class="timer-btn pause" onclick="pauseTimer()">⏸️ Pause</button>
            <button class="timer-btn stop" onclick="stopTimer()">⏹️ Stop</button>
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
                        console.log(`Could not fetch details for task ${task.task_id || task.id}:`, e);
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
    // Apple-style color palette - clean, modern colors sampled from gradient ranges
    const appleColors = [
        // Blues (from light sky to deep)
        '#007AFF', '#0051D5', '#003D82', '#5AC8FA', '#32ADE6', '#1F8FD6',
        
        // Purples (from light lavender to deep)
        '#AF52DE', '#8E44AD', '#6C3483', '#BF5AF2', '#9B59B6', '#7D3C98',

       
    ];
    
    // Simple hash function to generate consistent index for tags
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
        hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Ensure positive index and map to color array
    const colorIndex = Math.abs(hash) % appleColors.length;
    return appleColors[colorIndex];
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
        console.log('Audio notification not available');
    }
}

// Close modal when clicking outside
document.getElementById('settings-modal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeSettings();
    }
}); 