'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function UpdatePasswordPage() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // 可选：检查用户是否真的携带了恢复会话 (防误闯)
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('链接已失效或未授权，请重新获取重置邮件。');
        router.push('/auth');
      }
    };
    // Supabase 在处理带有 hash 的恢复链接时可能需要一点时间解析，稍微延时检查
    setTimeout(checkSession, 1000);
  }, [router]);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      return alert("两次输入的密码不一致！");
    }

    if (newPassword.length < 6) {
      return alert("密码长度至少需要 6 位");
    }

    setLoading(true);

    try {
      // 🌟 核心：因为用户点链接进来时，Supabase 已经赋予了他们一个临时会话
      // 所以我们直接调用 updateUser 就可以修改当前用户的密码了
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      alert("🎉 密码修改成功！请使用新密码重新登录。");
      
      // 修改成功后，可以选择将用户登出，强制他们用新密码重新走一遍登录流程
      await supabase.auth.signOut();
      router.push('/auth'); 

    } catch (error: any) {
      alert("密码更新失败: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 space-y-6 animate-in fade-in zoom-in-95">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4">
            <span className="text-2xl">🔐</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">设置新密码</h1>
          <p className="text-gray-500 mt-2 text-sm">请为您的账号设置一个新的安全密码</p>
        </div>

        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">新密码</label>
            <input 
              type="password" 
              required
              className="mt-1 w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              placeholder="至少 6 位字符"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">确认新密码</label>
            <input 
              type="password" 
              required
              className="mt-1 w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              placeholder="再次输入新密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          
          <button 
            type="submit"
            disabled={loading || !newPassword || !confirmPassword}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-bold py-3 rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed mt-4"
          >
            {loading ? '正在更新安全凭证...' : '确认修改密码'}
          </button>
        </form>
      </div>
    </div>
  );
}