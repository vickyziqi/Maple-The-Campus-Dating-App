// Replace these with your actual campus venues before demo
export const VENUES = [
  { name: "A3楼下咖啡厅", building: "A3", type: "cafe", vibe: "安静，有位置，不尴尬" },
  { name: "图书馆一楼休息区", building: "图书馆", type: "study_lounge", vibe: "随时有人，自然" },
  { name: "东门食堂二楼", building: "东食堂", type: "cafeteria", vibe: "午休高峰后安静" },
  { name: "理工楼中庭", building: "理工楼", type: "outdoor", vibe: "路过很自然" },
  { name: "学生活动中心一楼", building: "活动中心", type: "common_area", vibe: "宽松，不像约会" },
]

export const HARDCODED_FALLBACK_CARD = {
  time: "周四 12:15-13:00",
  venue: "图书馆一楼休息区",
  walk_minutes: 5,
  shared_context: "你们都在同一个校区",
  reasoning: "这是双方课间最近的共同空窗期，图书馆一楼安静、自然，不会有压力。",
  icebreaker: "你最近在读什么书，或者在忙什么课？",
}
