'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false); // 🌟 新增找回密码状态
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isForgotPassword) {
      // 🌟 发送重置密码邮件逻辑
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        // 重要：重定向到你即将创建的修改密码页面
        redirectTo: `${location.origin}/auth/update-password` 
      });
      if (error) alert(error.message);
      else alert('重置邮件已发送，请检查邮箱！');
    } else if (isSignUp) {
      // 注册逻辑
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` }
      });
      if (error) alert(error.message);
      else alert('请查收邮件以确认注册！');
    } else {
      // 登录逻辑
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
      else router.push('/'); // 登录成功跳转到首页
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">
            {isForgotPassword ? '找回密码' : (isSignUp ? '创建 AI 账号' : '欢迎回来')}
          </h1>
          <p className="text-gray-500 mt-2">
            {isForgotPassword ? '输入邮箱获取重置链接' : '开启你的 AI 视频创作之旅'}
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">邮箱地址</label>
            <input 
              type="email" 
              required
              className="mt-1 w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          
          {/* 找回密码时不需要输入密码 */}
          {!isForgotPassword && (
            <div>
              <label className="block text-sm font-medium text-gray-700">密码</label>
              <input 
                type="password" 
                required
                className="mt-1 w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? '处理中...' : (isForgotPassword ? '发送重置邮件' : (isSignUp ? '立即注册' : '登录系统'))}
          </button>
        </form>

        <div className="flex flex-col space-y-2 text-center">
          {/* 切换找回密码模式 */}
          {!isForgotPassword && (
            <button 
              onClick={() => setIsForgotPassword(true)}
              className="text-sm text-gray-500 hover:text-blue-600 transition-colors"
            >
              忘记密码？
            </button>
          )}

          {/* 切换注册/登录模式 */}
          <button 
            onClick={() => {
              setIsForgotPassword(false);
              setIsSignUp(!isSignUp);
            }}
            className="text-sm text-blue-600 hover:underline"
          >
            {isForgotPassword ? '返回登录' : (isSignUp ? '已有账号？去登录' : '没有账号？去注册')}
          </button>
        </div>
      </div>
    </div>
  );
}
