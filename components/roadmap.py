import streamlit as st
import pandas as pd
import requests
from utils.supabase_client import supabase
from streamlit_lottie import st_lottie

def load_lottieurl(url: str):
    r = requests.get(url)
    if r.status_code != 200:
        return None
    return r.json()

def get_user_logs(user_id):
    """
    Lấy lịch sử dữ liệu tracking từ Supabase.
    Nếu bảng user_logs chưa được tạo trên DB thì bắt lỗi và trả về mảng rỗng.
    """
    try:
        res = supabase.table("user_logs").select("*").eq("user_id", user_id).execute()
        return res.data
    except Exception:
        return []

def render_roadmap_agent():
    st.subheader("🤖 Trợ lý AI Lộ trình luyện mắt (Rule-based Engine)")
    
    user_id = "anonymous"
    logs = get_user_logs(user_id)
    
    if not logs:
        st.info("💡 Chưa có đủ dữ liệu để AI phân tích. Hãy sử dụng tính năng Tracking trong ít nhất 1 phiên (nhấn Lưu Log) để AI có thể đánh giá.")
        
        col_lottie, col_text = st.columns([1, 2])
        with col_lottie:
            lottie_robot = load_lottieurl("https://lottie.host/82a9dbcd-259d-4c37-88eb-116e1c4a520f/xTf2l2R9wP.json")
            if lottie_robot:
                st_lottie(lottie_robot, height=200, key="robot_empty")
        
        with col_text:
            # Rule-based fallback
            st.write("### Kế hoạch hành động mặc định (Default Roadmap):")
            st.success(
                "**1. Ngắn hạn (Trong ngày):**\n"
                "- Áp dụng **quy tắc 20-20-20**: Cứ 20 phút nhìn màn hình, hãy nhìn ra xa 20 feet (6m) trong 20 giây.\n"
                "- Tần số chớp mắt an toàn cần đạt: > 15 lần/phút.\n\n"
                "**2. Dài hạn (Theo tuần):**\n"
                "- Duy trì khoảng cách màn hình luôn ở mức 50-70cm.\n"
                "- Uống đủ nước để tránh khô mắt."
            )
        return

    # Nếu có logs, tính toán trung bình
    df = pd.DataFrame(logs)
    avg_ear = df['avg_ear'].mean() if 'avg_ear' in df else 0.2
    avg_dist = df['avg_distance'].mean() if 'avg_distance' in df else 60
    
    st.write("### 📊 Phân tích từ dữ liệu lịch sử của bạn:")
    col1, col2 = st.columns(2)
    col1.metric("EAR trung bình (Tổng quát)", f"{avg_ear:.2f}")
    col2.metric("Khoảng cách trung bình", f"{avg_dist:.0f} px")
    
    st.write("### 🎯 Lộ trình & Lời khuyên cá nhân hóa:")
    
    if avg_ear < 0.18:
        st.error("**Cảnh báo:** Mắt bạn có xu hướng mở nhỏ hoặc chớp chậm. Bạn cần tập bài tập nháy mắt liên tục và chườm ấm vùng mắt mỗi tối 10 phút.")
    else:
        st.success("**Tốt:** Chỉ số EAR của bạn khá ổn định. Hãy tiếp tục duy trì thói quen hiện tại!")
        
    if avg_dist > 110: # Nếu pixel lớn tức là mặt sát camera
        st.warning("**Khuyến nghị:** Bạn có thói quen ngồi quá gần màn hình. Hãy lùi lại khoảng 50-70cm để tránh cận thị tiến triển.")
    else:
        st.success("**Tư thế chuẩn:** Khoảng cách ngồi của bạn đang ở mức an toàn.")
        
    st.progress(70, text="Tiến độ hoàn thành mục tiêu bảo vệ mắt tuần này: 70%")
