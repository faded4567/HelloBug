enum AccessFailureSurface { fileTree, filePreview, historyList, historyDetail }

class AccessFailure {
  const AccessFailure({required this.message, this.retryable = true});

  final String message;
  final bool retryable;
}

AccessFailure resolveAccessFailure({
  required AccessFailureSurface surface,
  required String code,
  String fallback = '',
}) {
  final defaultMessage = switch (surface) {
    AccessFailureSurface.fileTree => '读取目录失败',
    AccessFailureSurface.filePreview => '读取文件失败',
    AccessFailureSurface.historyList => '历史记录读取失败',
    AccessFailureSurface.historyDetail => '历史详情读取失败',
  };
  final fallbackMessage =
      fallback.trim().isNotEmpty ? fallback.trim() : defaultMessage;

  switch (code) {
    case 'SESSION_NOT_FOUND':
      return AccessFailure(
        message: switch (surface) {
          AccessFailureSurface.fileTree => '该会话已结束，无法继续浏览工作区',
          AccessFailureSurface.filePreview => '该会话已结束，无法继续读取文件内容',
          AccessFailureSurface.historyList => '关联会话已失效，当前无法继续读取历史记录',
          AccessFailureSurface.historyDetail => '这段历史会话已失效，无法继续读取详情',
        },
        retryable: false,
      );
    case 'WORKSPACE_FORBIDDEN':
      return AccessFailure(
        message: switch (surface) {
          AccessFailureSurface.fileTree => '当前工作区已失效或无权限访问，请返回会话后重新选择工作区',
          AccessFailureSurface.filePreview => '当前工作区已失效或无权限访问，无法继续读取该文件',
          AccessFailureSurface.historyList => '当前工作区已失效或无权限访问，无法继续读取历史记录',
          AccessFailureSurface.historyDetail => '当前工作区已失效或无权限访问，无法继续读取这段历史',
        },
        retryable: false,
      );
    default:
      return AccessFailure(message: fallbackMessage);
  }
}
