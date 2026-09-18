/**
 * The locale namespace this plugin owns. `zh` is the key-set source of truth and
 * `en` is checked against it, so a missing or extra translation fails the build.
 * @module dsh-plugin-ui-background-image/client/locales
 */

/** Namespace this plugin registers its copy under. */
export const BACKGROUND_LOCALE_NAMESPACE = 'ui-background-image'

/** Simplified-Chinese dictionary; also the source of the key set. */
export const zh = {
  'background.title': '背景图片',
  'background.description': '界面底层的背景图片，不透明度可调',
  'background.trigger': '选择背景图片',
  'background.missing': '所选背景图片不可用，已回退到默认背景',
  'background.unknownName': '未知图片',

  'group.uploaded': '已上传',
  'group.presets': '预设',
  'group.remote': '远程图片',

  'preset.none': '无',
  'preset.mist': '薄雾',
  'preset.dusk': '暮色',
  'preset.ember': '暖霞',
  'preset.verdant': '青苔',

  'opacity.label': '不透明度',
  'opacity.value': '{value}%',
  'opacity.hint': '数值越高，背景越清晰',

  'action.manage': '上传与管理图片…',
  'action.reset': '恢复默认',
  'action.retry': '重新读取',
  'action.remove': '删除',
  'action.close': '关闭',

  'picker.title': '选择背景图片',
  'picker.description': '选中立即生效',

  'uploaded.empty': '尚未上传图片',

  'notice.uploaded': '图片已上传并启用',
  'notice.removed': '图片已删除',
  'notice.reset': '已恢复默认背景',
  'notice.loadFailed': '图片列表读取失败',
  'notice.uploadFailed': '上传失败',
  'notice.removeFailed': '删除失败',
  'notice.settingsFailed': '设置保存失败',
  'notice.tooLarge': '文件超出大小上限',

  'remote.label': '远程图片地址',
  'remote.placeholder': 'https://…',
  'remote.hint': '仅支持 https 公网图片；本机与内网地址一律拒绝。图片由浏览器直接加载，Host 不代取',
  'remote.inline': '内嵌图片',
  'remote.add': '使用此地址',
  'remote.reason.scheme': '只接受 https 地址',
  'remote.reason.credentials': '地址中不能包含用户名或密码',
  'remote.reason.length': '地址过长',
  'remote.reason.literal': '请填写域名，不能使用 IP 地址',
  'remote.reason.reserved': '该域名只指向本机或内网',
  'remote.reason.host': '该域名不在部署允许的名单里',
  'remote.reason.private': '该域名解析到内网地址，已拒绝',
  'remote.reason.unresolved': '该域名无法解析',
  'notice.remoteAdded': '已启用远程图片',
  'notice.remoteRefused': '远程图片地址被拒绝',
  'notice.remoteFailed': '远程图片未能启用',

  'manager.title': '图片管理',
  'manager.description': '上传的图片保存在以下目录；直接复制图片文件进去也会被识别：',
  'manager.descriptionRemote': '上传的图片保存在运行 dsh 的机器上，目录路径只在该机器上显示。',
  'manager.drop': '将图片文件拖到这里',
  'manager.or': '或',
  'manager.browse': '选择文件',
  'manager.hint': '支持 .png .jpg .jpeg .webp .gif .avif，文件需为有效图片',
  'manager.uploading': '正在上传…',
  'manager.listTitle': '已上传的图片',
  'manager.close': '关闭',

  'confirm.title': '删除图片',
  'confirm.description': '删除后无法恢复；若该图片正在使用，界面将回到默认背景',
  'confirm.cancel': '取消',
  'confirm.confirm': '删除',
}

/** Every copy key of this namespace. */
export type BackgroundKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Background image settings row and its dialogs. */
    [BACKGROUND_LOCALE_NAMESPACE]: BackgroundKey
  }
}

/** English dictionary, checked complete against the `zh` key set. */
export const en = {
  'background.title': 'Background image',
  'background.description': 'Image behind the interface, with an adjustable opacity',
  'background.trigger': 'Choose a background image',
  'background.missing': 'The chosen background image is unavailable; the default background is in use',
  'background.unknownName': 'Unknown image',

  'group.uploaded': 'Uploaded',
  'group.presets': 'Presets',
  'group.remote': 'Remote image',

  'preset.none': 'None',
  'preset.mist': 'Mist',
  'preset.dusk': 'Dusk',
  'preset.ember': 'Ember',
  'preset.verdant': 'Verdant',

  'opacity.label': 'Opacity',
  'opacity.value': '{value}%',
  'opacity.hint': 'Higher makes the background more visible',

  'action.manage': 'Upload and manage images…',
  'action.reset': 'Restore default',
  'action.retry': 'Read again',
  'action.remove': 'Delete',
  'action.close': 'Close',

  'picker.title': 'Choose a background image',
  'picker.description': 'Choosing one applies it immediately',

  'uploaded.empty': 'No image has been uploaded yet',

  'notice.uploaded': 'Image uploaded and selected',
  'notice.removed': 'Image deleted',
  'notice.reset': 'Default background restored',
  'notice.loadFailed': 'Could not read the image list',
  'notice.uploadFailed': 'Upload failed',
  'notice.removeFailed': 'Delete failed',
  'notice.settingsFailed': 'Could not save the setting',
  'notice.tooLarge': 'The file exceeds the size limit',

  'remote.label': 'Remote image URL',
  'remote.placeholder': 'https://…',
  'remote.hint': 'Public https images only. Addresses on this machine or its network are refused, and your browser loads the image rather than the Host.',
  'remote.inline': 'Inline image',
  'remote.add': 'Use this URL',
  'remote.reason.scheme': 'Only an https URL is accepted',
  'remote.reason.credentials': 'A URL may not carry a username or password',
  'remote.reason.length': 'The URL is too long',
  'remote.reason.literal': 'Use a hostname; an IP address is not accepted',
  'remote.reason.reserved': 'That name only points at this machine or its network',
  'remote.reason.host': 'That hostname is not on the list this deployment allows',
  'remote.reason.private': 'That name resolves to a private address, so it was refused',
  'remote.reason.unresolved': 'That name could not be resolved',
  'notice.remoteAdded': 'Remote image in use',
  'notice.remoteRefused': 'Remote image URL refused',
  'notice.remoteFailed': 'Could not apply the remote image',

  'manager.title': 'Manage images',
  'manager.description': 'Uploaded images are stored in this directory; copying an image file into it also works:',
  'manager.descriptionRemote': 'Uploaded images are stored on the machine running dsh; the path is shown only there',
  'manager.drop': 'Drop an image file here',
  'manager.or': 'or',
  'manager.browse': 'Choose a file',
  'manager.hint': 'Accepts .png .jpg .jpeg .webp .gif .avif; the file must be a valid image',
  'manager.uploading': 'Uploading…',
  'manager.listTitle': 'Uploaded images',
  'manager.close': 'Close',

  'confirm.title': 'Delete image',
  'confirm.description': 'This cannot be undone. If the image is in use, the interface returns to the default background.',
  'confirm.cancel': 'Cancel',
  'confirm.confirm': 'Delete',
} satisfies Record<BackgroundKey, string>
