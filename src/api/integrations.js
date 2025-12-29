const noop = async () => ({});
export const Core = {
  InvokeLLM: noop,
  SendEmail: noop,
  UploadFile: async () => ({ file_url: '' }),
  GenerateImage: noop,
  ExtractDataFromUploadedFile: noop,
  CreateFileSignedUrl: async () => ({ url: '' }),
  UploadPrivateFile: async () => ({ file_url: '' }),
};
export const InvokeLLM = Core.InvokeLLM;
export const SendEmail = Core.SendEmail;
export const UploadFile = Core.UploadFile;
export const GenerateImage = Core.GenerateImage;
export const ExtractDataFromUploadedFile = Core.ExtractDataFromUploadedFile;
export const CreateFileSignedUrl = Core.CreateFileSignedUrl;
export const UploadPrivateFile = Core.UploadPrivateFile;






