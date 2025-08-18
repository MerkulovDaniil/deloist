# 🌀 Deloist - Time Tracker powered by Todoist

A beautiful timer that seamlessly integrates with Todoist to track your productivity and visualize your completed tasks through stunning charts.
Free, open-source, and serverless.

I have made it for myself, because I love Todoist, but it lacks a session timer and a simple statistics of time spent on the tasks. I did not want to pay for such a simple feature.

**🌟 [Live Demo](https://delo.fmin.xyz/)**

## 🚀 Quick Start

### Online Usage (Recommended)
1. Visit **[https://delo.fmin.xyz/](https://delo.fmin.xyz/)**
2. Click the settings gear ⚙️ icon
3. Add your Todoist Personal Access Token
4. Start tracking your productivity!

### Local Setup
1. **Clone the repository**
   ```bash
   git clone https://github.com/MerkulovDaniil/deloist.git
   cd deloist
   ```

2. **Open in browser**
   Simply open index.html in your browser. 

3. **Configure Todoist integration**
   - Get your token from [Todoist Integrations](https://todoist.com/prefs/integrations)
   - Click settings ⚙️ and paste your token
   - Save settings

## ✨ Features

### 🍅 Smart Timer
- **25-minute focused work sessions** (customizable)
- **Play/Pause/Stop controls** with precise time tracking
- **Add 25 minutes** on-demand for longer sessions
- **Audio notifications** when timer completes
- **Task selection** from today's Todoist tasks

### 📊 Beautiful Statistics & Analytics
- **Real-time charts** showing completed task data by tags
- **Multiple time periods**: Day, Week, Working Week, Month
- **Daily breakdowns** with colorful bar charts
- **Tag-based visualization** with automatic color coding
- **Time formatting** in hours and minutes

### 🔗 Todoist Integration
- **Automatic task fetching** for today's schedule
- **Duration tracking** - automatically updates Todoist with time spent
- **Tag support** - visualize productivity by project tags
- **Secure API integration** using Personal Access Tokens

### 🎯 Goals per Label (Serverless)
- **New Goals tab** with one card per Todoist label
- **Goal text + optional image URL** (the image becomes the card background)
- **Inline edit** with a small pencil icon; minimal UI
- **Visibility toggle** (eye icon in editor): adds `hidden: true` to the goal; hidden goals are not shown
- **Serverless storage**: goals are saved in your Todoist Inbox task `deloist_service` as a single comment that begins with `DELOIST_GOALS_JSON` followed by a fenced JSON block
- **No extra tasks or projects** are created; your Todoist filters remain clean
- **Multi‑device**: changes sync via Todoist; the app uses local cache and only re‑fetches when you press refresh on the Goals tab

## 🔧 Configuration

### Todoist Personal Access Token
1. Go to [Todoist Integrations](https://todoist.com/prefs/integrations)
2. Scroll down to "Developer" section
3. Copy your "API token"
4. Paste it in Deloist settings

### Timer Settings
- **Session Duration**: Length of each session (default: 25 minutes)
- **Default Task Time**: Time assigned to completed tasks without duration tracking (default: 25 minutes) - this is needed for statistics.

## 📱 Usage Guide

### Starting a Work Session
1. **Select a task** from today's Todoist tasks
2. **Click Start ▶️** to begin the timer
3. **Focus on your work** for the duration
4. **Take a break** when the timer completes with an audio notification

### Timer Controls
- **▶️ Start/Resume**: Begin or continue the timer
- **⏸️ Pause**: Temporarily pause the current session
- **⏹️ Stop**: End the session and log time to Todoist
- **➕25**: Add 25 minutes to the current timer
- **🔄 Reset**: Reset timer to default duration
- **❌ Cancel**: Cancel the current session

### Viewing Statistics
1. **Switch to Statistics tab** 📊
2. **Select time period**: Day, Week, Working Week, or Month
3. **Click refresh 🔄** to load latest data
4. **Explore charts** showing your productivity by tags

## 📊 Statistics Explained

### Time Periods
- **Day**: Today's completed tasks
- **Week**: Last 7 days of activity
- **Working Week**: Monday through Sunday of current week
- **Month**: Current month's completed tasks

### Chart Features
- **Vertical bars** show total time spent
- **Color segments** represent different project tags
- **Tag breakdown** with precise time values
- **Daily views** for week and working week periods

## 🛠️ Technical Details

### Built With
- **Vanilla JavaScript** - No frameworks needed
- **CSS Grid & Flexbox** - Modern responsive layouts
- **Todoist REST API** - Real-time task synchronization
- **Web Audio API** - Timer completion notifications
- **LocalStorage** - Secure settings persistence

### Security & Privacy
- **Local storage only** - Your token stays in your browser
- **No data collection** - Everything happens client-side, I don't store any data or rent a server for this.
- **Secure API calls** - Direct HTTPS communication with Todoist

## 🧩 How Goals Storage Works

- The app looks for (or creates) a single Inbox task named `deloist_service` (no labels).
- The first comment that starts with `DELOIST_GOALS_JSON` contains all goals inside a fenced JSON block.
- Expected format in the comment:

  ```
  DELOIST_GOALS_JSON
  ```json
  {
    "version": 1,
    "goals": {
      "<labelId>": {
        "label": "Label Name",
        "text": "My goal",
        "image": "https://.../image.jpg",
        "hidden": true
      }
    }
  }
  ```
  ```

  ```json
  {
    "version": 1,
    "goals": {
      "<labelId>": {
        "text": "My goal",
        "image": "https://.../image.jpg",
        "hidden": true
      }
    }
  }
  ```

- You can edit this JSON manually in Todoist; edit strictly inside the fenced block and ensure the JSON stays valid.
- Hidden goals (`hidden: true`) are not rendered on the page; remove the field to show them again.
- The app caches goals and labels to avoid extra API calls; use the header refresh button while on the Goals tab to force reload.

## 🎯 Workflow Integration

### Recommended Usage
1. **Plan your day** in Todoist with proper tags
2. **Schedule tasks** for today
3. **Use Deloist** to track actual time spent
4. **Review statistics** to optimize your productivity

### Best Practices
- **Use descriptive tags** in Todoist (e.g., @coding, @meetings, @learning)
- **Plan realistic sessions** - start with 25-minute chunks
- **Take breaks** between sessions
- **Review daily/weekly stats** to identify patterns

## 🔍 Troubleshooting

### Common Issues
**Tasks not loading?**
- Check your Todoist token in settings
- Ensure you have tasks scheduled for today
- Try refreshing the page

**Statistics not showing?**
- Click the refresh button 🔄 in statistics tab
- Verify you have completed tasks with the integration active (only those tasks, that are completed in Todoist are counted in the statistics)
- Check that tasks have proper tags in Todoist

**Timer not accurate?**
- The timer accounts for pause time automatically
- Time tracking updates Todoist when you stop the timer
- Browser tab switching doesn't affect accuracy

**I have spent a time on a task, but it's not counted in the statistics**
- Check that you have completed the task in Todoist
- Check that the time spent on the task is at least 1 minute
- Check that you have set the default task time in settings
- Check that you have set the session duration in settings
- Check that you have set the default task time in settings