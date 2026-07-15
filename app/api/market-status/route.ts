import { NextResponse } from 'next/server';

// ============================================
// FOREX MARKET HOURS DETECTION
// Forex market hours: Sunday 5PM EST - Friday 5PM EST
// ============================================

interface MarketSession {
  name: string;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

function getForexMarketStatus() {
  const now = new Date();
  
  // Convert to New York time (EST/EDT)
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = nyTime.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;
  
  // Format current time
  const formattedTime = nyTime.toLocaleString('en-US', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'
  });
  
  let isOpen = false;
  let status = 'CLOSED';
  let nextOpen = '';
  let nextClose = '';
  let reason = '';
  
  if (day === 6) {
    // Saturday - market closed
    isOpen = false;
    status = 'CLOSED';
    reason = 'Weekend - Saturday';
    nextOpen = 'Sunday 5:00 PM EST';
  } else if (day === 0) {
    // Sunday - opens at 5PM
    if (timeInMinutes >= 17 * 60) {
      isOpen = true;
      status = 'OPEN';
      reason = 'Sydney session starting';
      nextClose = 'Friday 5:00 PM EST';
    } else {
      isOpen = false;
      status = 'CLOSED';
      reason = 'Weekend - Opens later today';
      nextOpen = 'Today 5:00 PM EST';
    }
  } else if (day === 5) {
    // Friday - closes at 5PM
    if (timeInMinutes < 17 * 60) {
      isOpen = true;
      status = 'OPEN';
      reason = 'Last trading day of week';
      nextClose = 'Today 5:00 PM EST';
    } else {
      isOpen = false;
      status = 'CLOSED';
      reason = 'Weekend - Friday close';
      nextOpen = 'Sunday 5:00 PM EST';
    }
  } else {
    // Monday-Thursday - market open 24h
    isOpen = true;
    status = 'OPEN';
    nextClose = 'Friday 5:00 PM EST';
    
    // Determine current session
    if (hour >= 0 && hour < 8) {
      reason = 'Asian session (Tokyo/Sydney)';
    } else if (hour >= 8 && hour < 12) {
      reason = 'London/Asia overlap';
    } else if (hour >= 12 && hour < 17) {
      reason = 'New York session';
    } else {
      reason = 'Sydney session';
    }
  }
  
  // Get individual session status
  const sessions: MarketSession[] = getSessions(nyTime);
  
  return {
    isOpen,
    status,
    reason,
    nextOpen: isOpen ? null : nextOpen,
    nextClose: isOpen ? nextClose : null,
    currentTimeNY: formattedTime,
    timestamp: now.toISOString(),
    sessions
  };
}

function getSessions(nyTime: Date): MarketSession[] {
  const hour = nyTime.getHours();
  const day = nyTime.getDay();
  
  // Sessions in NY time (approximate)
  // Sydney: 5PM - 2AM
  // Tokyo: 7PM - 4AM  
  // London: 3AM - 12PM
  // New York: 8AM - 5PM
  
  const isWeekend = day === 0 && hour < 17 || day === 6;
  
  return [
    {
      name: 'Sydney',
      isOpen: !isWeekend && (hour >= 17 || hour < 2),
      openTime: '5:00 PM',
      closeTime: '2:00 AM'
    },
    {
      name: 'Tokyo',
      isOpen: !isWeekend && (hour >= 19 || hour < 4),
      openTime: '7:00 PM',
      closeTime: '4:00 AM'
    },
    {
      name: 'London',
      isOpen: !isWeekend && (hour >= 3 && hour < 12),
      openTime: '3:00 AM',
      closeTime: '12:00 PM'
    },
    {
      name: 'New York',
      isOpen: !isWeekend && (hour >= 8 && hour < 17),
      openTime: '8:00 AM',
      closeTime: '5:00 PM'
    }
  ];
}

export async function GET() {
  const marketStatus = getForexMarketStatus();
  
  return NextResponse.json(marketStatus, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  });
}
