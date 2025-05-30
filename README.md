# 💎 Deloist - Time Tracker powered by Todoist

A beautiful timer that seamlessly integrates with Todoist to track your productivity and visualize your completed tasks through stunning charts.

**🌟 [Live Demo](https://merkulov.top/deloist)**

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

### 🎨 Modern Design
- **Clean, minimalist interface** with gradient backgrounds
- **Responsive design** that works on all devices
- **Smooth animations** and hover effects
- **Intuitive navigation** between Tracker and Statistics

## 🚀 Quick Start

### Online Usage (Recommended)
1. Visit **[https://merkulov.top/deloist](https://merkulov.top/deloist)**
2. Click the settings gear ⚙️ icon
3. Add your Todoist Personal Access Token
4. Start tracking your productivity!

### Local Setup
1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd deloist
   ```

2. **Open in browser**
   ```bash
   # Simply open index.html in your browser
   open index.html
   # or
   python -m http.server 8000  # For local server
   ```

3. **Configure Todoist integration**
   - Get your token from [Todoist Integrations](https://todoist.com/prefs/integrations)
   - Click settings ⚙️ and paste your token
   - Save settings

## 🔧 Configuration

### Todoist Personal Access Token
1. Go to [Todoist Integrations](https://todoist.com/prefs/integrations)
2. Scroll down to "Developer" section
3. Copy your "API token"
4. Paste it in Deloist settings

### Timer Settings
- **Diamond Duration**: Length of each session (default: 25 minutes)
- **Default Task Time**: Time assigned to completed tasks without duration tracking (default: 25 minutes)

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
- **+25**: Add 25 minutes to the current timer
- **🔄 Reset**: Reset timer to default duration

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

### Browser Compatibility
- **Chrome/Edge**: Full support
- **Firefox**: Full support
- **Safari**: Full support
- **Mobile browsers**: Responsive design

### Security & Privacy
- **Local storage only** - Your token stays in your browser
- **No data collection** - Everything happens client-side
- **Secure API calls** - Direct HTTPS communication with Todoist

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
- Verify you have completed tasks with the integration active
- Check that tasks have proper tags in Todoist

**Timer not accurate?**
- The timer accounts for pause time automatically
- Time tracking updates Todoist when you stop the timer
- Browser tab switching doesn't affect accuracy

## 🤝 Contributing

This is a simple, self-contained project perfect for:
- **Feature additions** (new timer modes, export options)
- **UI improvements** (themes, animations)
- **Todoist enhancements** (project filtering, advanced stats)

## 📄 License

Open source project - feel free to use and modify as needed.

## 🙏 Acknowledgments

- **Todoist** for their excellent API
- **Modern CSS** inspiration from contemporary design systems

---

**Start tracking your productivity today!** 💎 [Try Deloist](https://merkulov.top/deloist)