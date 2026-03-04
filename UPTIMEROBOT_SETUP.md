# UptimeRobot Setup Instructions

## What This Does
Prevents your Render web service from sleeping due to inactivity by pinging it every 5 minutes.

## Step 1: Deploy to Render
1. Push your code to GitHub
2. Create a new **Web Service** on Render (not Background Worker for this method)
3. Connect your GitHub repository
4. Render will automatically detect the start command
5. Add all your environment variables (including the AUTH_* variables)
6. Deploy!

## Step 2: Get Your Render URL
After deployment, Render will give you a URL like:
```
https://your-app-name.onrender.com
```

## Step 3: Configure UptimeRobot
1. Go to https://uptimerobot.com and sign up (free account)
2. Click **Add New Monitor**
3. Configure:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: Minecraft Discord Bot
   - **URL**: `https://your-app-name.onrender.com/health`
   - **Monitoring Interval**: 5 minutes
4. Click **Create Monitor**

## Done!
Your bot will now:
- ✅ Stay awake 24/7 on Render's free tier
- ✅ Get pinged every 5 minutes by UptimeRobot
- ✅ Never spin down due to inactivity

## Testing Locally
Run `npm start` and visit http://localhost:3000/health to see the health check endpoint.

## Note
- Render's free tier has 750 hours/month
- With UptimeRobot pinging every 5 minutes, you'll use about 720 hours/month
- This keeps you within the free tier limits!
